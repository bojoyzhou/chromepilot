// Proxy handlers (per-tab + global)
// Extracted from legacy.ts HANDLERS

import { proxyState, interceptRules, globalProxy, setGlobalProxy } from "../shared-state";
import { ensureDebugger, detachDebugger, debuggerStillNeeded } from "../debugger-manager";
import { resolveTabId } from "../command-router";
import { getFetchPatterns } from "../modules/proxy-utils";

// ── Global Proxy Functions ──

async function attachGlobalProxy(tabId: number): Promise<boolean> {
  if (!globalProxy || globalProxy.paused) return false;
  const existing = proxyState.get(tabId);
  if (existing && existing._global) {
    existing.rules = globalProxy.rules;
    existing.whistleText = globalProxy.whistleText;
    return true;
  }
  if (existing) return true;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && (tab.url.startsWith("chrome") || tab.url.startsWith("devtools://"))) {
      console.log(`[globalProxy] skip tab ${tabId}: ${tab.url?.slice(0, 30)}`);
      return false;
    }
    if (!(await ensureDebugger(tabId))) {
      console.warn(
        `[globalProxy] debugger attach failed for tab ${tabId}: ${tab.url?.slice(0, 60)}`,
      );
      return false;
    }
    proxyState.set(tabId, {
      rules: globalProxy.rules,
      log: [],
      _global: true,
      whistleText: globalProxy.whistleText,
    });
    if (globalProxy.rules.some((r: any) => r.setHost)) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Security.setIgnoreCertificateErrors", {
          override: true,
        });
      } catch {
        /* ignore */
      }
    }
    await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
      patterns: getFetchPatterns(globalProxy.rules as any),
    });
    console.log(`[globalProxy] attached tab ${tabId}: ${tab.url?.slice(0, 60)}`);
    return true;
  } catch (e: any) {
    console.error(`[globalProxy] error attaching tab ${tabId}:`, e);
    return false;
  }
}

export async function startGlobalProxy(rules: any[], whistleText?: string): Promise<number> {
  setGlobalProxy({ rules, whistleText: whistleText || "" });
  const tabs = await chrome.tabs.query({});
  let n = 0;
  for (const t of tabs) {
    if (t.id && (await attachGlobalProxy(t.id))) n++;
  }
  return n;
}

export async function stopGlobalProxy(): Promise<void> {
  if (!globalProxy) return;
  setGlobalProxy(null);
  for (const [tabId, st] of [...proxyState.entries()]) {
    if (!st._global) continue;
    proxyState.delete(tabId);
    if (!interceptRules.has(tabId)) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
      } catch {
        /* ignore */
      }
    }
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
  }
}

export async function pauseGlobalProxy(): Promise<void> {
  if (!globalProxy || globalProxy.paused) return;
  globalProxy.paused = true;
  for (const [tabId, st] of proxyState.entries()) {
    if (!st._global) continue;
    st._paused = true;
    try {
      await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
    } catch {
      /* ignore */
    }
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
  }
}

export async function resumeGlobalProxy(): Promise<void> {
  if (!globalProxy || !globalProxy.paused) return;
  globalProxy.paused = false;
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id) continue;
    const st = proxyState.get(t.id);
    if (st && st._global && st._paused) {
      if (await ensureDebugger(t.id)) {
        if (globalProxy.rules.some((r: any) => r.setHost)) {
          try {
            await chrome.debugger.sendCommand(
              { tabId: t.id },
              "Security.setIgnoreCertificateErrors",
              { override: true },
            );
          } catch {
            /* ignore */
          }
        }
        await chrome.debugger.sendCommand({ tabId: t.id }, "Fetch.enable", {
          patterns: getFetchPatterns(globalProxy.rules as any),
        });
        st._paused = false;
      }
    } else if (!proxyState.has(t.id)) {
      await attachGlobalProxy(t.id);
    }
  }
}

export async function updateGlobalRules(rules: any[], whistleText?: string): Promise<void> {
  if (!globalProxy) return;
  const oldRules = globalProxy.rules;
  globalProxy.rules = rules;
  if (whistleText !== undefined) globalProxy.whistleText = whistleText;
  const hadResHeader = oldRules.some((r: any) => r.action === "resHeader");
  const hasResHeader = rules.some((r: any) => r.action === "resHeader");
  const patternsChanged = hadResHeader !== hasResHeader;
  for (const [tabId, st] of proxyState.entries()) {
    if (st._global) {
      st.rules = rules;
      if (whistleText !== undefined) st.whistleText = whistleText;
      if (patternsChanged) {
        try {
          await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
          await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
            patterns: getFetchPatterns(rules as any),
          });
        } catch (e: any) {
          console.warn(`[globalProxy] re-enable Fetch failed for tab ${tabId}:`, e.message);
        }
      }
    }
  }
}

// Re-export for lifecycle.ts
export { attachGlobalProxy };

// ── Per-tab Proxy Handlers ──

export const proxyHandlers = {
  async proxy_start(cmd: any) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    if (!(await ensureDebugger(tabId))) {
      return { error: "Cannot attach debugger. Close DevTools for this tab first." };
    }
    const rules = cmd.rules || [];
    proxyState.set(tabId, { rules, log: [] });
    await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
      patterns: getFetchPatterns(rules),
    });
    return { ok: true, tabId, ruleCount: rules.length };
  },

  async proxy_stop(cmd: any) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    const state = proxyState.get(tabId);
    const logCount = state?.log?.length || 0;
    proxyState.delete(tabId);
    if (!interceptRules.has(tabId)) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
      } catch {
        /* ignore */
      }
    }
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
    return { ok: true, logCount };
  },

  async proxy_update(cmd: any) {
    const tabId = await resolveTabId(cmd);
    const state = proxyState.get(tabId);
    if (!state) return { error: "Proxy not active on this tab. Start with proxy_start first." };
    const oldRules = state.rules;
    state.rules = cmd.rules || [];
    const hadRes = oldRules.some((r: any) => r.action === "resHeader");
    const hasRes = state.rules.some((r: any) => r.action === "resHeader");
    if (hadRes !== hasRes) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
        await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
          patterns: getFetchPatterns(state.rules as any),
        });
      } catch {
        /* ignore */
      }
    }
    return { ok: true, ruleCount: state.rules.length };
  },

  async proxy_list(cmd: any) {
    const tabId = await resolveTabId(cmd);
    const state = proxyState.get(tabId);
    if (!state) return { data: [], active: false };
    return { data: state.rules, active: true, tabId };
  },

  async proxy_log(cmd: any) {
    const tabId = await resolveTabId(cmd);
    const state = proxyState.get(tabId);
    let log = state?.log || [];
    if (cmd.limit) log = log.slice(-cmd.limit);
    return { data: log, total: (state?.log || []).length };
  },

  async proxy_clear_log(cmd: any) {
    const tabId = await resolveTabId(cmd);
    const state = proxyState.get(tabId);
    if (state) state.log = [];
    return { ok: true };
  },

  async proxy_start_global(cmd: any) {
    const rules = cmd.rules || [];
    const n = await startGlobalProxy(rules, cmd.whistleText);
    return { ok: true, global: true, ruleCount: rules.length, tabCount: n };
  },

  async proxy_stop_global() {
    await stopGlobalProxy();
    return { ok: true };
  },

  async proxy_pause_global() {
    await pauseGlobalProxy();
    return { ok: true };
  },

  async proxy_resume_global() {
    await resumeGlobalProxy();
    return { ok: true };
  },
};
