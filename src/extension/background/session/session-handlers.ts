// Session management handlers
// Extracted from legacy.ts HANDLERS

import { proxyState } from "../shared-state";
import type { SessionData } from "../session/session-state";
import {
  sessions,
  assignColor,
  releaseColor,
  findSessionByTab,
  addActionLog,
  computeBadgeState,
  computeTabGroupProps,
} from "../session/session-state";
import { ensureDebugger, detachDebugger, debuggerStillNeeded } from "../debugger-manager";
import { resolveTabId } from "../command-router";
import { pushEvent } from "../ws-bridge";
import {
  injectTitlePrefix,
  removeTitlePrefix,
  injectAgentSuppressors,
  enableDialogAutoAccept,
} from "../session/session-injection";

function updateBadge() {
  const { text, color } = computeBadgeState();
  chrome.action.setBadgeText({ text });
  if (color) {
    chrome.action.setBadgeBackgroundColor({ color });
  }
}

async function updateTabGroupState(session: SessionData) {
  if (!session.groupId) return;
  const props = computeTabGroupProps(session);
  try {
    await chrome.tabGroups.update(session.groupId, {
      title: props.title,
      color: props.color as any,
    });
  } catch (e: any) {
    console.warn("[session] tabGroup update failed:", e.message);
  }
}

// Export for use by lifecycle.ts and other modules
export { updateBadge, updateTabGroupState };

export const sessionHandlers = {
  async session_start(cmd: any) {
    const sessionId = `s-${crypto.randomUUID().slice(0, 8)}`;
    const name = cmd.name || sessionId;

    let tabId: number | undefined;
    if (cmd.newTab) {
      const tab = await chrome.tabs.create({ url: cmd.newTab, active: false });
      tabId = tab.id;
    } else {
      tabId = await resolveTabId(cmd);
    }
    if (!tabId) return { error: "No tab to assign to session" };

    if (!(await ensureDebugger(tabId))) {
      return { error: "Cannot attach debugger. Close DevTools for this tab first." };
    }

    const color = assignColor();
    let groupId: number | null = null;
    try {
      groupId = await chrome.tabs.group({ tabIds: [tabId] });
      await chrome.tabGroups.update(groupId, {
        title: `[Agent] ${name}`,
        color: color as any,
        collapsed: false,
      });
    } catch (e: any) {
      console.warn("[session] Tab Group creation failed:", e.message);
      groupId = null;
    }

    const session: SessionData = {
      sessionId,
      name,
      tabIds: [tabId],
      groupId,
      color,
      createdAt: Date.now(),
      lastHeartbeat: Date.now(),
      lastCommandAt: Date.now(),
      status: "active" as const,
      actionLog: [],
    };
    sessions.set(sessionId, session);

    await enableDialogAutoAccept(tabId);
    await injectTitlePrefix(tabId);
    await injectAgentSuppressors(tabId);

    if (sessions.size === 1) {
      chrome.alarms.create("session_heartbeat_check", { periodInMinutes: 1 });
      chrome.alarms.create("session_auto_collapse", { periodInMinutes: 0.25 });
    }

    updateBadge();
    addActionLog(session, "start", `Session started with tab ${tabId}`);
    pushEvent("session.start", tabId, { sessionId, name, color });

    return { sessionId, tabId, groupId, color, name };
  },

  async session_heartbeat(cmd: any) {
    const session = sessions.get(cmd.sessionId);
    if (!session) return { error: "Session not found" };
    session.lastHeartbeat = Date.now();
    if (session.status === "orphaned") {
      session.status = "active";
      await updateTabGroupState(session);
    }
    return { ok: true, status: session.status, tabCount: session.tabIds.length };
  },

  async session_list() {
    const list = [...sessions.values()].map((s) => ({
      sessionId: s.sessionId,
      name: s.name,
      status: s.status,
      tabIds: s.tabIds,
      groupId: s.groupId,
      color: s.color,
      createdAt: s.createdAt,
      lastHeartbeat: s.lastHeartbeat,
      lastCommandAt: s.lastCommandAt,
    }));
    return { data: list };
  },

  async session_stop(cmd: any) {
    const session = sessions.get(cmd.sessionId);
    if (!session) return { error: "Session not found" };

    for (const tabId of session.tabIds) {
      const pState = proxyState.get(tabId);
      if (pState && !pState._global) {
        proxyState.delete(tabId);
        try {
          await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
        } catch {
          /* ignore */
        }
      }
      if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
      await removeTitlePrefix(tabId);
    }

    if (session.groupId) {
      try {
        await chrome.tabs.ungroup(session.tabIds as [number, ...number[]]);
      } catch {
        /* ignore */
      }
    }

    releaseColor(session.color);
    addActionLog(session, "stop", "Session stopped");
    session.status = "closed";
    sessions.delete(cmd.sessionId);

    if (sessions.size === 0) {
      chrome.alarms.clear("session_heartbeat_check");
      chrome.alarms.clear("session_auto_collapse");
    }

    updateBadge();
    pushEvent("session.stop", null, { sessionId: cmd.sessionId });
    return { ok: true };
  },

  async session_cleanup() {
    const now = Date.now();
    const cleaned: string[] = [];
    for (const [id, s] of sessions.entries()) {
      if (now - s.lastHeartbeat > 120_000 && s.status !== "closed") {
        await sessionHandlers.session_stop({ sessionId: id });
        cleaned.push(id);
      }
    }
    return { ok: true, cleaned };
  },

  async session_pause(cmd: any) {
    const session = sessions.get(cmd.sessionId);
    if (!session) return { error: "Session not found" };
    if (session.status === "paused") return { ok: true, already: true };
    session.status = "paused";
    await updateTabGroupState(session);
    addActionLog(session, "pause", "Session paused");
    updateBadge();
    return { ok: true };
  },

  async session_resume(cmd: any) {
    const session = sessions.get(cmd.sessionId);
    if (!session) return { error: "Session not found" };
    if (session.status !== "paused") return { ok: true, already: true };
    session.status = "active";
    session.lastHeartbeat = Date.now();
    for (const tabId of session.tabIds) {
      await ensureDebugger(tabId);
      await enableDialogAutoAccept(tabId);
    }
    await updateTabGroupState(session);
    addActionLog(session, "resume", "Session resumed");
    updateBadge();
    return { ok: true };
  },

  async session_add_tab(cmd: any) {
    const session = sessions.get(cmd.sessionId);
    if (!session) return { error: "Session not found" };
    const tabId = cmd.tabId;
    if (!tabId) return { error: "tabId required" };
    if (session.tabIds.includes(tabId)) return { ok: true, already: true };

    const existing = findSessionByTab(tabId);
    if (existing) return { error: `Tab ${tabId} already belongs to session ${existing.sessionId}` };

    session.tabIds.push(tabId);
    await ensureDebugger(tabId);
    await enableDialogAutoAccept(tabId);
    await injectTitlePrefix(tabId);
    await injectAgentSuppressors(tabId);

    if (session.groupId) {
      try {
        await chrome.tabs.group({ tabIds: [tabId], groupId: session.groupId });
      } catch {
        /* ignore */
      }
    }

    addActionLog(session, "add_tab", `Tab ${tabId} added`);
    return { ok: true, tabIds: session.tabIds };
  },

  async session_log(cmd: any) {
    const session = sessions.get(cmd.sessionId);
    if (!session) return { error: "Session not found" };
    return { data: session.actionLog, sessionId: session.sessionId, name: session.name };
  },
};
