// Chrome event listeners — lifecycle, cleanup, tab events
// Extracted from legacy.ts

import {
  debuggerTabs,
  networkBuffers,
  consoleBuffers,
  interceptRules,
  proxyState,
  globalProxy,
} from "./shared-state";
import { sessions, findSessionByTab, sessionOwnsTab, addActionLog } from "./session/session-state";
import { pushEvent } from "./ws-bridge";
import { connect } from "./ws-bridge";
import { ensureDebugger } from "./debugger-manager";
import {
  injectTitlePrefix,
  injectAgentSuppressors,
  enableDialogAutoAccept,
} from "./session/session-injection";
import { attachGlobalProxy } from "./handlers/proxy-handlers";
import { updateBadge, updateTabGroupState } from "./session/session-handlers";

export function registerLifecycleListeners(): void {
  // ── Debugger Detach ──
  chrome.debugger.onDetach.addListener((source, reason) => {
    const tabId = source.tabId!;
    debuggerTabs.delete(tabId);

    const session = findSessionByTab(tabId);
    if (session) {
      const reasonStr = reason as string;
      if (reasonStr === "replaced_with_devtools" || reasonStr === "canceled_by_user") {
        session.status = "degraded";
        updateTabGroupState(session);
        updateBadge();
        addActionLog(session, "debugger_detach", `Tab ${tabId} debugger detached: ${reason}`);
        pushEvent("session.degraded", tabId, { sessionId: session.sessionId, reason: reasonStr });
      } else {
        session.tabIds = session.tabIds.filter((t) => t !== tabId);
        if (session.tabIds.length === 0) {
          session.status = "orphaned";
          updateTabGroupState(session);
          pushEvent("session.orphaned", null, { sessionId: session.sessionId });
        }
        updateBadge();
        addActionLog(session, "tab_lost", `Tab ${tabId} lost: ${reasonStr || "unknown"}`);
      }
    }

    networkBuffers.delete(tabId);
    consoleBuffers.delete(tabId);
    interceptRules.delete(tabId);
    proxyState.delete(tabId);
  });

  // ── Tab Removed ──
  chrome.tabs.onRemoved.addListener((tabId) => {
    const session = findSessionByTab(tabId);
    if (session) {
      session.tabIds = session.tabIds.filter((t) => t !== tabId);
      if (session.tabIds.length === 0) {
        session.status = "orphaned";
        updateTabGroupState(session);
        pushEvent("session.orphaned", null, { sessionId: session.sessionId });
      }
      updateBadge();
      addActionLog(session, "tab_removed", `Tab ${tabId} was closed`);
    }

    debuggerTabs.delete(tabId);
    networkBuffers.delete(tabId);
    consoleBuffers.delete(tabId);
    interceptRules.delete(tabId);
    proxyState.delete(tabId);
  });

  // ── Alarms ──
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "reconnect" || alarm.name === "keepalive") {
      connect();
    }
    if (alarm.name === "session_heartbeat_check") {
      const now = Date.now();
      for (const s of sessions.values()) {
        if (s.status === "active" && now - s.lastHeartbeat > 120_000) {
          s.status = "orphaned";
          updateTabGroupState(s);
          pushEvent("session.orphaned", null, { sessionId: s.sessionId });
        }
      }
      updateBadge();
    }
    if (alarm.name === "session_auto_collapse") {
      const now = Date.now();
      for (const s of sessions.values()) {
        if (s.groupId && s.status === "active" && now - s.lastCommandAt > 10_000) {
          try {
            chrome.tabGroups.update(s.groupId, { collapsed: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
  });

  // ── Install/Startup ──
  chrome.runtime.onInstalled.addListener(() => connect());
  chrome.runtime.onStartup.addListener(() => connect());

  // ── Tab Updated (Global Proxy + Session) ──
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (globalProxy && !proxyState.has(tabId)) {
      if (changeInfo.url || changeInfo.status === "loading" || changeInfo.status === "complete") {
        if (
          tab.url &&
          !tab.url.startsWith("chrome") &&
          !tab.url.startsWith("about:") &&
          !tab.url.startsWith("devtools://")
        ) {
          attachGlobalProxy(tabId);
        }
      }
    }

    if (changeInfo.status === "complete" && sessionOwnsTab(tabId)) {
      injectTitlePrefix(tabId);
      injectAgentSuppressors(tabId);
    }

    if (changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      const session = findSessionByTab(tabId);
      if (session && session.groupId) {
        try {
          chrome.tabs.group({ tabIds: [tabId], groupId: session.groupId });
        } catch {
          /* ignore */
        }
      }
    }
  });

  // ── Tab Created (Global Proxy + Session auto-claim) ──
  chrome.tabs.onCreated.addListener((tab) => {
    if (globalProxy && tab.id) {
      setTimeout(() => attachGlobalProxy(tab.id!), 100);
    }

    if (tab.openerTabId) {
      const session = findSessionByTab(tab.openerTabId);
      if (session && tab.id && !session.tabIds.includes(tab.id)) {
        session.tabIds.push(tab.id);
        (async () => {
          await ensureDebugger(tab.id!);
          await enableDialogAutoAccept(tab.id!);
          if (session.groupId) {
            try {
              await chrome.tabs.group({ tabIds: [tab.id!], groupId: session.groupId });
            } catch {
              /* ignore */
            }
          }
          await injectTitlePrefix(tab.id!);
          await injectAgentSuppressors(tab.id!);
          addActionLog(
            session,
            "auto_claim",
            `Tab ${tab.id} auto-claimed from opener ${tab.openerTabId}`,
          );
        })();
      }
    }
  });
}
