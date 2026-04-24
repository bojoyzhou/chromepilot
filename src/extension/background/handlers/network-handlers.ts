// Network capture handlers
// Extracted from legacy.ts HANDLERS

import { networkBuffers, debuggerTabs, interceptRules, proxyState } from "../shared-state";
import { ensureDebugger, detachDebugger, debuggerStillNeeded } from "../debugger-manager";
import { resolveTabId } from "../command-router";
import { filterRequests } from "./network-filter";

export const networkHandlers = {
  async network_start(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    if (!(await ensureDebugger(tabId))) {
      return { error: "Cannot attach debugger. Close DevTools for this tab first." };
    }
    networkBuffers.set(tabId, []);
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    return { ok: true, tabId };
  },

  async network_stop(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    const count = (networkBuffers.get(tabId) || []).length;
    try {
      await chrome.debugger.sendCommand({ tabId }, "Network.disable");
    } catch {
      /* ignore */
    }
    networkBuffers.delete(tabId);
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
    return { ok: true, count };
  },

  async network_requests(cmd) {
    const tabId = await resolveTabId(cmd);
    const reqs = (networkBuffers.get(tabId) || []) as any[];
    const result = filterRequests(reqs, {
      urlPattern: cmd.urlPattern,
      method: cmd.method,
      status: cmd.status,
      type: cmd.type,
      completed: cmd.completed,
      limit: cmd.limit,
    });
    return { data: result, total: result.length };
  },

  async network_clear(cmd) {
    const tabId = await resolveTabId(cmd);
    if (networkBuffers.has(tabId)) networkBuffers.set(tabId, []);
    return { ok: true };
  },

  async network_body(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId || !debuggerTabs.has(tabId)) {
      return { error: "Network capture not active on this tab" };
    }
    try {
      const result = await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", {
        requestId: cmd.requestId,
      });
      const r = result as { body: string; base64Encoded: boolean };
      return { body: r.body, base64Encoded: r.base64Encoded };
    } catch (e) {
      return { error: `Cannot get body: ${e.message}` };
    }
  },

  async network_intercept(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    if (!(await ensureDebugger(tabId))) {
      return { error: "Cannot attach debugger" };
    }
    const rules = cmd.rules || [];
    interceptRules.set(tabId, rules);
    await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    return { ok: true, tabId, ruleCount: rules.length };
  },

  async network_intercept_stop(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    interceptRules.delete(tabId);
    if (!proxyState.has(tabId)) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
      } catch {
        /* ignore */
      }
    }
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
    return { ok: true };
  },
};
