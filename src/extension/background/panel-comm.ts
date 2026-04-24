// Panel (Side Panel) communication handler
// Extracted from legacy.ts — chrome.runtime.onMessage listener

import {
  proxyState,
  globalProxy,
  networkBuffers,
  consoleBuffers,
  interceptRules,
  commandHistory,
  MAX_PROXY_LOG,
} from "./shared-state";
import { sessions } from "./session/session-state";
import { send, isConnected } from "./ws-bridge";
import {
  proxyHandlers,
  startGlobalProxy,
  stopGlobalProxy,
  pauseGlobalProxy,
  resumeGlobalProxy,
  updateGlobalRules,
} from "./handlers/proxy-handlers";

export function registerPanelListener(): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handlePanelMessage(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: e.message }));
    return true; // async response
  });
}

async function handlePanelMessage(msg: any): Promise<any> {
  switch (msg.type) {
    case "getState":
      return await buildPanelState();
    case "proxyStop":
      return await proxyHandlers.proxy_stop({ tabId: msg.tabId });
    case "proxyClearLog":
      return await proxyHandlers.proxy_clear_log({ tabId: msg.tabId });
    case "proxyUpdate":
      return await proxyHandlers.proxy_update({ tabId: msg.tabId, rules: msg.rules });
    case "proxyUpdateRules": {
      const result = await proxyHandlers.proxy_update({ tabId: msg.tabId, rules: msg.rules });
      const pState = proxyState.get(msg.tabId);
      if (pState && msg.whistleText !== undefined) {
        pState.whistleText = msg.whistleText;
      }
      send({
        _event: true,
        type: "proxy.rules_updated",
        tabId: msg.tabId,
        rules: msg.rules,
        whistleText: msg.whistleText,
        ts: Date.now(),
      });
      return result;
    }
    case "proxyStartTab": {
      const rules = msg.rules || [];
      const result = await proxyHandlers.proxy_start({ tabId: msg.tabId, rules });
      const pState = proxyState.get(msg.tabId);
      if (pState && msg.whistleText !== undefined) {
        pState.whistleText = msg.whistleText;
      }
      send({
        _event: true,
        type: "proxy.rules_updated",
        tabId: msg.tabId,
        rules,
        whistleText: msg.whistleText,
        ts: Date.now(),
      });
      return result;
    }
    case "proxyStartGlobal": {
      const rules = msg.rules || [];
      const n = await startGlobalProxy(rules, msg.whistleText);
      send({
        _event: true,
        type: "proxy.global_updated",
        rules,
        whistleText: msg.whistleText,
        ts: Date.now(),
      });
      return { ok: true, global: true, tabCount: n };
    }
    case "proxyStopGlobal": {
      await stopGlobalProxy();
      send({ _event: true, type: "proxy.global_stopped", ts: Date.now() });
      return { ok: true };
    }
    case "proxyUpdateGlobalRules": {
      const rules = msg.rules || [];
      await updateGlobalRules(rules, msg.whistleText);
      send({
        _event: true,
        type: "proxy.global_updated",
        rules,
        whistleText: msg.whistleText,
        ts: Date.now(),
      });
      return { ok: true, ruleCount: rules.length };
    }
    case "proxyGlobalClearLog": {
      for (const [, st] of proxyState.entries()) {
        if (st._global) st.log = [];
      }
      return { ok: true };
    }
    case "proxyPauseGlobal": {
      await pauseGlobalProxy();
      send({ _event: true, type: "proxy.global_paused", ts: Date.now() });
      return { ok: true };
    }
    case "proxyResumeGlobal": {
      await resumeGlobalProxy();
      send({ _event: true, type: "proxy.global_resumed", ts: Date.now() });
      return { ok: true };
    }
    case "clearCommandHistory": {
      commandHistory.length = 0;
      return { ok: true };
    }
    default:
      return { error: `Unknown popup message: ${msg.type}` };
  }
}

async function buildPanelState(): Promise<any> {
  const connected = isConnected();

  const activeTabIds = new Set([
    ...networkBuffers.keys(),
    ...consoleBuffers.keys(),
    ...interceptRules.keys(),
    ...proxyState.keys(),
  ]);

  const featureTabs: any[] = [];
  for (const tabId of activeTabIds) {
    const pState = proxyState.get(tabId);
    featureTabs.push({
      tabId,
      features: {
        network: networkBuffers.has(tabId),
        console: consoleBuffers.has(tabId),
        intercept: interceptRules.has(tabId),
        proxy: !!pState,
      },
      networkCount: (networkBuffers.get(tabId) || []).length,
      consoleCount: (consoleBuffers.get(tabId) || []).length,
      proxy: pState
        ? {
            rules: pState.rules,
            log: pState.log,
            whistleText: pState.whistleText,
            _global: !!pState._global,
          }
        : null,
    });
  }

  let browserTabs: any[] = [];
  try {
    const allTabs = await chrome.tabs.query({});
    browserTabs = allTabs.map((t) => ({
      tabId: t.id,
      url: t.url,
      title: t.title,
      active: t.active,
    }));
  } catch {
    /* ignore */
  }

  let globalProxyState: any = null;
  if (globalProxy) {
    globalProxyState = {
      active: true,
      paused: !!globalProxy.paused,
      rules: globalProxy.rules,
      whistleText: globalProxy.whistleText || "",
      tabCount: [...proxyState.entries()].filter(([, st]) => st._global).length,
      log: [] as any[],
    };
    for (const [, st] of proxyState.entries()) {
      if (st._global && st.log) {
        globalProxyState.log.push(...st.log);
      }
    }
    globalProxyState.log.sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0));
    if (globalProxyState.log.length > MAX_PROXY_LOG) globalProxyState.log.length = MAX_PROXY_LOG;
  }

  return {
    connected,
    tabs: featureTabs,
    browserTabs,
    globalProxy: globalProxyState,
    commandHistory: [...commandHistory],
    sessions: [...sessions.values()].map((s) => ({
      sessionId: s.sessionId,
      name: s.name,
      status: s.status,
      tabIds: s.tabIds,
      groupId: s.groupId,
      color: s.color,
      createdAt: s.createdAt,
      lastHeartbeat: s.lastHeartbeat,
    })),
  };
}
