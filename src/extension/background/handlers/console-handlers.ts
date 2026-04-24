// Console capture handlers
// Extracted from legacy.ts HANDLERS

import { consoleBuffers } from "../shared-state";
import { ensureDebugger, detachDebugger, debuggerStillNeeded } from "../debugger-manager";
import { resolveTabId } from "../command-router";

export const consoleHandlers = {
  async console_start(cmd: any) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    if (!(await ensureDebugger(tabId))) {
      return { error: "Cannot attach debugger" };
    }
    consoleBuffers.set(tabId, []);
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    return { ok: true, tabId };
  },

  async console_stop(cmd: any) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    const count = (consoleBuffers.get(tabId) || []).length;
    try {
      await chrome.debugger.sendCommand({ tabId }, "Runtime.disable");
    } catch {
      /* ignore */
    }
    consoleBuffers.delete(tabId);
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
    return { ok: true, count };
  },

  async console_messages(cmd: any) {
    const tabId = await resolveTabId(cmd);
    let msgs = consoleBuffers.get(tabId) || [];
    if (cmd.level) msgs = msgs.filter((m: any) => m.level === cmd.level);
    if (cmd.limit) msgs = msgs.slice(-cmd.limit);
    return { data: msgs, total: msgs.length };
  },

  async console_clear(cmd: any) {
    const tabId = await resolveTabId(cmd);
    if (consoleBuffers.has(tabId)) consoleBuffers.set(tabId, []);
    return { ok: true };
  },
};
