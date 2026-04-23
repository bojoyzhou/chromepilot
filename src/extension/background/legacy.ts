// @ts-nocheck
import { setIconConnected, setIconDisconnected } from "./modules/icon-state";
import { getFetchPatterns, injectCookiesIfMissing } from "./modules/proxy-utils";

// ChromePilot Extension v2 — Service Worker (Manifest V3)
// Full-featured AI pilot: JS execution, network capture, cookies, console, screenshots
//
// Architecture: CLI → HTTP → server.py → WebSocket → this extension → Chrome APIs
// Key advantage: executeScript runs in MAIN world = page context + login session

const DEFAULT_WS = "ws://127.0.0.1:8787/ws";
let ws = null;
let wsUrl = DEFAULT_WS;

// ── Icon State (extracted to modules/icon-state.ts)
// Start with disconnected state
setIconDisconnected();

// ── State ────────────────────────────────────────────────────
const networkBuffers = new Map(); // tabId → [request entries]
const consoleBuffers = new Map(); // tabId → [console entries]
const debuggerTabs = new Set(); // tabs with debugger attached
const interceptRules = new Map(); // tabId → [rules]
const pendingBodies = new Map(); // tabId → Map(requestId → {resolve, timer})
const proxyState = new Map(); // tabId → { rules: [], log: [] }
let globalProxy = null; // null | { rules: [], whistleText: '' }
const commandHistory = []; // { id, action, tabId, urlMatch, ts, raw }
const MAX_COMMAND_HISTORY = 100;

// ── Global Proxy ─────────────────────────────────────────────
// Determine Fetch interception patterns based on rules.
// If any rule modifies response headers (resHeader), also intercept at Response stage.
// getFetchPatterns extracted to modules/proxy-utils.ts

async function attachGlobalProxy(tabId) {
  if (!globalProxy || globalProxy.paused) return false;
  // If tab already has global proxy state, update rules to match current globalProxy
  const existing = proxyState.get(tabId);
  if (existing && existing._global) {
    existing.rules = globalProxy.rules;
    existing.whistleText = globalProxy.whistleText;
    return true;
  }
  // If tab has per-tab proxy, don't override it
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
    // If any rule uses IP host mapping (setHost), ignore cert errors for HTTPS→IP redirect
    if (globalProxy.rules.some((r) => r.setHost)) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Security.setIgnoreCertificateErrors", {
          override: true,
        });
      } catch {}
    }
    await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
      patterns: getFetchPatterns(globalProxy.rules),
    });
    console.log(`[globalProxy] attached tab ${tabId}: ${tab.url?.slice(0, 60)}`);
    return true;
  } catch (e) {
    console.error(`[globalProxy] error attaching tab ${tabId}:`, e);
    return false;
  }
}

async function startGlobalProxy(rules, whistleText) {
  globalProxy = { rules, whistleText: whistleText || "" };
  const tabs = await chrome.tabs.query({});
  let n = 0;
  for (const t of tabs) {
    if (await attachGlobalProxy(t.id)) n++;
  }
  return n;
}

async function stopGlobalProxy() {
  if (!globalProxy) return;
  globalProxy = null;
  for (const [tabId, st] of [...proxyState.entries()]) {
    if (!st._global) continue;
    proxyState.delete(tabId);
    if (!interceptRules.has(tabId)) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
      } catch {}
    }
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
  }
}

async function pauseGlobalProxy() {
  if (!globalProxy || globalProxy.paused) return;
  globalProxy.paused = true;
  // Disable Fetch on all global proxy tabs but keep proxyState entries
  for (const [tabId, st] of proxyState.entries()) {
    if (!st._global) continue;
    st._paused = true;
    try {
      await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
    } catch {}
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
  }
}

async function resumeGlobalProxy() {
  if (!globalProxy || !globalProxy.paused) return;
  globalProxy.paused = false;
  // Re-enable Fetch on existing global tabs, re-attach to new tabs
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    const st = proxyState.get(t.id);
    if (st && st._global && st._paused) {
      // Re-attach debugger and Fetch for previously paused tabs
      if (await ensureDebugger(t.id)) {
        if (globalProxy.rules.some((r) => r.setHost)) {
          try {
            await chrome.debugger.sendCommand(
              { tabId: t.id },
              "Security.setIgnoreCertificateErrors",
              { override: true },
            );
          } catch {}
        }
        await chrome.debugger.sendCommand({ tabId: t.id }, "Fetch.enable", {
          patterns: getFetchPatterns(globalProxy.rules),
        });
        st._paused = false;
      }
    } else if (!proxyState.has(t.id)) {
      // New tabs opened during pause
      await attachGlobalProxy(t.id);
    }
  }
}

async function updateGlobalRules(rules, whistleText) {
  if (!globalProxy) return;
  const oldRules = globalProxy.rules;
  globalProxy.rules = rules;
  if (whistleText !== undefined) globalProxy.whistleText = whistleText;

  // Check if Fetch patterns need updating (resHeader presence changed)
  const hadResHeader = oldRules.some((r) => r.action === "resHeader");
  const hasResHeader = rules.some((r) => r.action === "resHeader");
  const patternsChanged = hadResHeader !== hasResHeader;

  for (const [tabId, st] of proxyState.entries()) {
    if (st._global) {
      st.rules = rules;
      if (whistleText !== undefined) st.whistleText = whistleText;
      if (patternsChanged) {
        try {
          await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
          await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
            patterns: getFetchPatterns(rules),
          });
        } catch (e) {
          console.warn(`[globalProxy] re-enable Fetch failed for tab ${tabId}:`, e.message);
        }
      }
    }
  }
}

// ── WebSocket Connection ─────────────────────────────────────
function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  try {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      console.log("[chromepilot] Connected to server");
      setIconConnected();
      chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
    };
    ws.onmessage = (event) => {
      try {
        handleCommand(JSON.parse(event.data));
      } catch (e) {
        console.error("[chromepilot] Parse error:", e);
      }
    };
    ws.onclose = () => {
      ws = null;
      setIconDisconnected();
      chrome.alarms.create("reconnect", { delayInMinutes: 0.05 });
    };
    ws.onerror = () => {
      ws = null;
      setIconDisconnected();
    };
  } catch (e) {
    console.error("[chromepilot] Connect error:", e);
    chrome.alarms.create("reconnect", { delayInMinutes: 0.1 });
  }
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Push real-time event to server (for streaming)
function pushEvent(type, tabId, data) {
  send({ _event: true, type, tabId, data, ts: Date.now() });
}

// ── Tab Resolution ───────────────────────────────────────────
async function resolveTabId(cmd) {
  if (cmd.tabId) return cmd.tabId;
  if (cmd.urlMatch) {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((t) => t.url && t.url.includes(cmd.urlMatch));
    if (match) return match.id;
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active?.id;
}

// ── Debugger Management ──────────────────────────────────────
async function ensureDebugger(tabId) {
  if (debuggerTabs.has(tabId)) return true;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    debuggerTabs.add(tabId);
    return true;
  } catch (e) {
    console.warn(`[debugger] attach failed tab ${tabId}:`, e.message);
    return false;
  }
}

async function detachDebugger(tabId) {
  if (!debuggerTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {}
  debuggerTabs.delete(tabId);
}

// Check if debugger is still needed for this tab
function debuggerStillNeeded(tabId) {
  return (
    networkBuffers.has(tabId) ||
    consoleBuffers.has(tabId) ||
    interceptRules.has(tabId) ||
    proxyState.has(tabId)
  );
}

// ── Command Router ───────────────────────────────────────────
async function handleCommand(cmd) {
  // Record command in history
  const historyEntry = {
    id: cmd.id || null,
    action: cmd.action || cmd.type || null,
    tabId: cmd.tabId || null,
    urlMatch: cmd.urlMatch || null,
    ts: Date.now(),
    raw: JSON.stringify(cmd).slice(0, 2000),
  };
  commandHistory.push(historyEntry);
  if (commandHistory.length > MAX_COMMAND_HISTORY) {
    commandHistory.shift();
  }

  const id = cmd.id;
  if (!id) {
    // Handle server-pushed events (no id = not a command response)
    if (cmd._event && cmd.type === "proxy.set_whistle_text") {
      const pState = proxyState.get(cmd.tabId);
      if (pState) pState.whistleText = cmd.whistleText;
    }
    return;
  }

  try {
    const handler = HANDLERS[cmd.action];
    if (!handler) {
      send({ id, error: `Unknown action: ${cmd.action}` });
      return;
    }
    const result = await handler(cmd);
    send({ id, ...result });
  } catch (e) {
    send({ id, error: e.message });
  }
}

// ── Handlers ─────────────────────────────────────────────────
const HANDLERS = {
  // -- Ping --
  async ping() {
    return { pong: true };
  },

  // -- Tabs --
  async list_tabs() {
    const tabs = await chrome.tabs.query({});
    return {
      data: tabs.map((t) => ({
        tabId: t.id,
        url: t.url,
        title: t.title,
        active: t.active,
        windowId: t.windowId,
        status: t.status,
        incognito: t.incognito,
      })),
    };
  },

  async tab_create(cmd) {
    const tab = await chrome.tabs.create({
      url: cmd.url || "about:blank",
      active: cmd.active !== false,
    });
    return { tabId: tab.id, url: tab.pendingUrl || tab.url };
  },

  async tab_close(cmd) {
    const ids = Array.isArray(cmd.tabId) ? cmd.tabId : [cmd.tabId];
    await chrome.tabs.remove(ids);
    return { ok: true };
  },

  async tab_reload(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    await chrome.tabs.reload(tabId, { bypassCache: !!cmd.bypassCache });
    return { ok: true, tabId };
  },

  async tab_activate(cmd) {
    const tabId = cmd.tabId;
    if (!tabId) return { error: "tabId required" };
    const tab = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { ok: true };
  },

  // -- Evaluate --
  async evaluate(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab found" };

    const world = cmd.world || "MAIN";
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (expr) => {
        try {
          return eval(expr);
        } catch (e) {
          return { __error__: e.message, __stack__: e.stack };
        }
      },
      args: [cmd.expression],
      world,
    });

    const val = results[0]?.result;
    if (val && val.__error__) {
      return { error: val.__error__, stack: val.__stack__ };
    }
    return { result: val };
  },

  // -- Navigate --
  async navigate(cmd) {
    let tabId = cmd.tabId;
    if (tabId) {
      await chrome.tabs.update(tabId, { url: cmd.url });
    } else {
      const tab = await chrome.tabs.create({ url: cmd.url });
      tabId = tab.id;
    }
    // Optionally wait for load
    if (cmd.waitForLoad) {
      await new Promise((resolve) => {
        const listener = (tid, info) => {
          if (tid === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, cmd.timeout || 30000);
      });
    }
    return { ok: true, tabId };
  },

  // -- Network Capture --
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
    } catch {}
    networkBuffers.delete(tabId);
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
    return { ok: true, count };
  },

  async network_requests(cmd) {
    const tabId = await resolveTabId(cmd);
    let reqs = networkBuffers.get(tabId) || [];

    // Filters
    if (cmd.urlPattern) {
      const re = new RegExp(cmd.urlPattern);
      reqs = reqs.filter((r) => re.test(r.url));
    }
    if (cmd.method) {
      reqs = reqs.filter((r) => r.method === cmd.method.toUpperCase());
    }
    if (cmd.status) {
      reqs = reqs.filter((r) => r.statusCode === cmd.status);
    }
    if (cmd.type) {
      reqs = reqs.filter((r) => r.type === cmd.type);
    }
    // Only completed
    if (cmd.completed) {
      reqs = reqs.filter((r) => r.statusCode != null);
    }
    // Limit (from tail)
    if (cmd.limit) {
      reqs = reqs.slice(-cmd.limit);
    }
    return { data: reqs, total: reqs.length };
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
      return { body: result.body, base64Encoded: result.base64Encoded };
    } catch (e) {
      return { error: `Cannot get body: ${e.message}` };
    }
  },

  // -- Network Intercept --
  async network_intercept(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    if (!(await ensureDebugger(tabId))) {
      return { error: "Cannot attach debugger" };
    }

    const rules = cmd.rules || [];
    interceptRules.set(tabId, rules);

    // Use wildcard CDP pattern to catch all requests, then filter in handler via regex.
    // requestStage "Request" intercepts before the request is sent to the server.
    await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    return { ok: true, tabId, ruleCount: rules.length };
  },

  async network_intercept_stop(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    interceptRules.delete(tabId);
    // Only disable Fetch if proxy is not also using it on this tab
    if (!proxyState.has(tabId)) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
      } catch {}
    }
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
    return { ok: true };
  },

  // -- Proxy (Whistle-like) --
  async proxy_start(cmd) {
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

  async proxy_stop(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    const state = proxyState.get(tabId);
    const logCount = state?.log?.length || 0;
    proxyState.delete(tabId);
    if (!interceptRules.has(tabId)) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
      } catch {}
    }
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
    return { ok: true, logCount };
  },

  async proxy_update(cmd) {
    const tabId = await resolveTabId(cmd);
    const state = proxyState.get(tabId);
    if (!state) return { error: "Proxy not active on this tab. Start with proxy_start first." };
    const oldRules = state.rules;
    state.rules = cmd.rules || [];
    // Re-enable Fetch if resHeader presence changed
    const hadRes = oldRules.some((r) => r.action === "resHeader");
    const hasRes = state.rules.some((r) => r.action === "resHeader");
    if (hadRes !== hasRes) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
        await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
          patterns: getFetchPatterns(state.rules),
        });
      } catch {}
    }
    return { ok: true, ruleCount: state.rules.length };
  },

  async proxy_list(cmd) {
    const tabId = await resolveTabId(cmd);
    const state = proxyState.get(tabId);
    if (!state) return { data: [], active: false };
    return { data: state.rules, active: true, tabId };
  },

  async proxy_log(cmd) {
    const tabId = await resolveTabId(cmd);
    const state = proxyState.get(tabId);
    let log = state?.log || [];
    if (cmd.limit) log = log.slice(-cmd.limit);
    return { data: log, total: (state?.log || []).length };
  },

  async proxy_clear_log(cmd) {
    const tabId = await resolveTabId(cmd);
    const state = proxyState.get(tabId);
    if (state) state.log = [];
    return { ok: true };
  },

  // -- Global Proxy --
  async proxy_start_global(cmd) {
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

  // -- Console --
  async console_start(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    if (!(await ensureDebugger(tabId))) {
      return { error: "Cannot attach debugger" };
    }
    consoleBuffers.set(tabId, []);
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    return { ok: true, tabId };
  },

  async console_stop(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    const count = (consoleBuffers.get(tabId) || []).length;
    try {
      await chrome.debugger.sendCommand({ tabId }, "Runtime.disable");
    } catch {}
    consoleBuffers.delete(tabId);
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
    return { ok: true, count };
  },

  async console_messages(cmd) {
    const tabId = await resolveTabId(cmd);
    let msgs = consoleBuffers.get(tabId) || [];
    if (cmd.level) msgs = msgs.filter((m) => m.level === cmd.level);
    if (cmd.limit) msgs = msgs.slice(-cmd.limit);
    return { data: msgs, total: msgs.length };
  },

  async console_clear(cmd) {
    const tabId = await resolveTabId(cmd);
    if (consoleBuffers.has(tabId)) consoleBuffers.set(tabId, []);
    return { ok: true };
  },

  // -- Cookies --
  async cookie_list(cmd) {
    const query = {};
    if (cmd.domain) query.domain = cmd.domain;
    if (cmd.url) query.url = cmd.url;
    if (cmd.name) query.name = cmd.name;
    const cookies = await chrome.cookies.getAll(query);
    return { data: cookies };
  },

  async cookie_set(cmd) {
    const cookie = await chrome.cookies.set({
      url: cmd.url,
      name: cmd.name,
      value: cmd.value,
      domain: cmd.domain,
      path: cmd.path || "/",
      secure: !!cmd.secure,
      httpOnly: !!cmd.httpOnly,
      sameSite: cmd.sameSite || "lax",
      expirationDate: cmd.expirationDate,
    });
    return { ok: true, cookie };
  },

  async cookie_delete(cmd) {
    await chrome.cookies.remove({ url: cmd.url, name: cmd.name });
    return { ok: true };
  },

  // -- Screenshot --
  async screenshot(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };

    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) {
      await chrome.tabs.update(tabId, { active: true });
      await new Promise((r) => setTimeout(r, 300));
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: cmd.format || "png",
      quality: cmd.quality || 90,
    });
    return { dataUrl };
  },

  // -- Page Info (convenience) --
  async page_info(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };

    const tab = await chrome.tabs.get(tabId);
    // Get page metrics via eval
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        contentType: document.contentType,
        characterSet: document.characterSet,
        referrer: document.referrer,
        cookies: document.cookie ? document.cookie.split(";").length : 0,
        localStorage: Object.keys(localStorage).length,
        sessionStorage: Object.keys(sessionStorage).length,
        performance: {
          domContentLoaded: Math.round(
            performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
          ),
          load: Math.round(performance.timing.loadEventEnd - performance.timing.navigationStart),
        },
      }),
      world: "MAIN",
    });
    return { data: { ...results[0]?.result, tabId: tab.id, status: tab.status } };
  },
};

// ── Debugger Event Dispatcher ────────────────────────────────
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;

  // ─ Network events ─
  if (method === "Network.requestWillBeSent") {
    const buf = networkBuffers.get(tabId);
    if (!buf) return;
    const entry = {
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      headers: params.request.headers,
      postData: params.request.postData || null,
      type: params.type,
      initiator: params.initiator?.type,
      ts: params.wallTime ? Math.round(params.wallTime * 1000) : Date.now(),
    };
    buf.push(entry);
    pushEvent("net.request", tabId, { url: entry.url, method: entry.method, type: entry.type });
  }

  if (method === "Network.responseReceived") {
    const buf = networkBuffers.get(tabId);
    if (!buf) return;
    const entry = buf.find((r) => r.requestId === params.requestId);
    if (entry) {
      entry.statusCode = params.response.status;
      entry.statusText = params.response.statusText;
      entry.responseHeaders = params.response.headers;
      entry.mimeType = params.response.mimeType;
      entry.remoteAddr = params.response.remoteIPAddress;
      entry.protocol = params.response.protocol;
      pushEvent("net.response", tabId, {
        url: entry.url,
        status: entry.statusCode,
        mimeType: entry.mimeType,
      });
    }
  }

  if (method === "Network.loadingFinished") {
    const buf = networkBuffers.get(tabId);
    if (!buf) return;
    const entry = buf.find((r) => r.requestId === params.requestId);
    if (entry) {
      entry.size = params.encodedDataLength;
      entry.done = true;
    }
  }

  if (method === "Network.loadingFailed") {
    const buf = networkBuffers.get(tabId);
    if (!buf) return;
    const entry = buf.find((r) => r.requestId === params.requestId);
    if (entry) {
      entry.error = params.errorText;
      entry.canceled = params.canceled;
      entry.done = true;
    }
  }

  // ─ Fetch interception (proxy + legacy intercept) ─
  if (method === "Fetch.requestPaused") {
    const url = params.request.url;

    // --- Proxy rules ---
    const pState = proxyState.get(tabId);
    if (pState) {
      // ── Response stage: apply resHeader modifiers ──
      if (params.responseStatusCode !== undefined) {
        // Check disable rules first — skip resHeader if disabled
        for (const r of pState.rules) {
          if (r.action !== "disable") continue;
          let matches;
          try {
            matches = new RegExp(r.pattern).test(url);
          } catch {
            matches = url.includes(r.pattern);
          }
          if (matches) {
            chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
              requestId: params.requestId,
            });
            return;
          }
        }

        const resHeaderMods = {};
        for (const r of pState.rules) {
          if (r.action !== "resHeader") continue;
          let matches;
          try {
            matches = new RegExp(r.pattern).test(url);
          } catch {
            matches = url.includes(r.pattern);
          }
          if (!matches) continue;
          Object.assign(resHeaderMods, r.setHeaders || {});
        }

        if (Object.keys(resHeaderMods).length > 0) {
          // Smart CORS: replace Access-Control-Allow-Origin: * with actual origin
          // Modern browsers reject wildcard (*) when credentials (cookies) are included
          const acaoKey = Object.keys(resHeaderMods).find(
            (k) => k.toLowerCase() === "access-control-allow-origin",
          );
          if (acaoKey && resHeaderMods[acaoKey] === "*") {
            // Extract origin from request headers (case-insensitive)
            const reqHeaders = params.request.headers || {};
            let origin = "";
            for (const [hk, hv] of Object.entries(reqHeaders)) {
              if (hk.toLowerCase() === "origin") {
                origin = hv;
                break;
              }
            }
            // Fallback: derive from Referer header
            if (!origin) {
              for (const [hk, hv] of Object.entries(reqHeaders)) {
                if (hk.toLowerCase() === "referer") {
                  try {
                    const u = new URL(hv);
                    origin = u.origin;
                  } catch {}
                  break;
                }
              }
            }
            if (origin && origin !== "null") {
              resHeaderMods[acaoKey] = origin;
              // Also ensure Access-Control-Allow-Credentials is set
              if (
                !Object.keys(resHeaderMods).find(
                  (k) => k.toLowerCase() === "access-control-allow-credentials",
                )
              ) {
                resHeaderMods["Access-Control-Allow-Credentials"] = "true";
              }
            }
          }

          // Build modified response headers
          const headers = [...(params.responseHeaders || [])];
          for (const [k, v] of Object.entries(resHeaderMods)) {
            const idx = headers.findIndex((h) => h.name.toLowerCase() === k.toLowerCase());
            if (idx >= 0) headers[idx].value = v;
            else headers.push({ name: k, value: v });
          }
          chrome.debugger.sendCommand({ tabId }, "Fetch.continueResponse", {
            requestId: params.requestId,
            responseCode: params.responseStatusCode,
            responseHeaders: headers,
          });
          const logEntry = {
            url,
            method: params.request.method,
            action: "resHeader",
            pattern: "resHeader",
            detail: `resHeaders: ${Object.keys(resHeaderMods).join(", ")}`,
            ts: Date.now(),
          };
          pState.log.push(logEntry);
          pushEvent("proxy.hit", tabId, logEntry);
        } else {
          // No resHeader match at Response stage, pass through
          chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
            requestId: params.requestId,
          });
        }
        return;
      }

      // ── Request stage: disable → header modifiers → main action ──
      // Pass 0: check for 'disable' rules — if matched, pass through immediately
      for (const r of pState.rules) {
        if (r.action !== "disable") continue;
        let matches;
        try {
          matches = new RegExp(r.pattern).test(url);
        } catch {
          matches = url.includes(r.pattern);
        }
        if (matches) {
          chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
            requestId: params.requestId,
          });
          return; // bypass all proxy rules for this request
        }
      }

      // Pass 1: collect header modifiers from all matching 'header' rules
      // Pass 2: find first matching non-header/non-resHeader rule as the "main action"
      const headerMods = {};
      let actionRule = null;

      for (const r of pState.rules) {
        let matches;
        try {
          matches = new RegExp(r.pattern).test(url);
        } catch {
          matches = url.includes(r.pattern);
        }
        if (!matches) continue;

        if ((r.action || "mock") === "header") {
          Object.assign(headerMods, r.setHeaders || {});
        } else if (r.action === "resHeader") {
          // Skip — handled at Response stage
        } else if (!actionRule) {
          actionRule = r;
        }
      }

      const hasHeaderMods = Object.keys(headerMods).length > 0;

      if (actionRule || hasHeaderMods) {
        // Helper: apply headerMods to a headers object → CDP headers array
        function buildHeaders(original) {
          const headers = Object.entries(original || {}).map(([n, v]) => ({ name: n, value: v }));
          for (const [k, v] of Object.entries(headerMods)) {
            const idx = headers.findIndex((h) => h.name.toLowerCase() === k.toLowerCase());
            if (idx >= 0) headers[idx].value = v;
            else headers.push({ name: k, value: v });
          }
          return headers;
        }

        const rule = actionRule || { action: "header", pattern: Object.keys(headerMods).join(",") };
        const action = rule.action || "mock";

        const logEntry = {
          url,
          method: params.request.method,
          pattern: rule.pattern,
          action,
          ts: Date.now(),
        };
        if (hasHeaderMods && action !== "header") {
          logEntry.headerMods = Object.keys(headerMods).join(", ");
        }

        if (action === "block") {
          chrome.debugger.sendCommand({ tabId }, "Fetch.failRequest", {
            requestId: params.requestId,
            reason: "Failed",
          });
          logEntry.detail = "blocked";
        } else if (action === "redirect") {
          let targetUrl = rule.target;
          try {
            const re = new RegExp(rule.pattern);
            targetUrl = url.replace(re, rule.target);
          } catch {}

          if (rule.setHost) {
            // Host mapping: proxy through server.py with correct TLS SNI
            // Target can be IP address or hostname (host:// rules)
            const ipMatch = targetUrl.match(/(\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?)/);
            let proxyTarget = ipMatch ? ipMatch[1] : null;
            if (!proxyTarget) {
              // Not an IP — extract hostname from target URL for host:// rules
              try {
                const u = new URL(targetUrl);
                if (u.hostname !== rule.setHost) proxyTarget = u.hostname;
              } catch {}
            }
            if (proxyTarget) {
              // Merge headerMods into the request headers sent to server
              const mergedHeaders = { ...params.request.headers, ...headerMods };
              (async () => {
                try {
                  // CDP Fetch.requestPaused provides headers BEFORE the browser's
                  // cookie store injects the Cookie header. Since we use fulfillRequest
                  // (bypassing the network layer entirely), we must manually inject cookies.
                  await injectCookiesIfMissing(mergedHeaders, url);
                  const resp = await fetch("http://127.0.0.1:8787/proxy/fetch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      url,
                      ip: proxyTarget,
                      host: rule.setHost,
                      method: params.request.method,
                      headers: mergedHeaders,
                      postData: params.request.postData || undefined,
                    }),
                  });
                  const data = await resp.json();
                  if (data.error) throw new Error(data.error);
                  const rHeaders = Object.entries(data.headers || {}).map(([n, v]) => ({
                    name: n,
                    value: String(v),
                  }));
                  await chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
                    requestId: params.requestId,
                    responseCode: data.status || 200,
                    responseHeaders: rHeaders,
                    body: data.body || "",
                  });
                } catch (e) {
                  console.error(`[proxy] host mapping fetch failed for ${url}:`, e.message);
                  chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
                    requestId: params.requestId,
                  });
                }
              })();
              logEntry.detail = `⇄ ${rule.setHost} → ${proxyTarget}`;
            } else {
              const cmd = { requestId: params.requestId, url: targetUrl };
              if (hasHeaderMods) cmd.headers = buildHeaders(params.request.headers);
              chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", cmd);
              logEntry.detail = `→ ${targetUrl}`;
            }
          } else {
            const cmd = { requestId: params.requestId, url: targetUrl };
            if (hasHeaderMods) cmd.headers = buildHeaders(params.request.headers);
            chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", cmd);
            logEntry.detail = `→ ${targetUrl}`;
          }
        } else if (action === "delay") {
          const ms = rule.delay || 1000;
          setTimeout(() => {
            const cmd = { requestId: params.requestId };
            if (hasHeaderMods) cmd.headers = buildHeaders(params.request.headers);
            chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", cmd);
          }, ms);
          logEntry.detail = `${ms}ms`;
        } else if (action === "header") {
          // Pure header modification (no other action matched)
          const headers = buildHeaders(params.request.headers);
          chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
            requestId: params.requestId,
            headers,
          });
          logEntry.detail = `headers: ${Object.keys(headerMods).join(", ")}`;
        } else {
          // mock (default)
          const resp = rule.response || rule;
          const rHeaders = Object.entries(resp.headers || {}).map(([n, v]) => ({
            name: n,
            value: String(v),
          }));
          if (!rHeaders.find((h) => h.name.toLowerCase() === "content-type")) {
            rHeaders.push({ name: "content-type", value: "application/json" });
          }
          const bodyStr =
            typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body || "");
          chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
            requestId: params.requestId,
            responseCode: resp.status || 200,
            responseHeaders: rHeaders,
            body: btoa(unescape(encodeURIComponent(bodyStr))),
          });
          logEntry.detail = `mock ${resp.status || 200}`;
        }

        pState.log.push(logEntry);
        pushEvent("proxy.hit", tabId, logEntry);
        return; // handled by proxy, skip legacy intercept
      }
    }

    // --- Legacy intercept rules (backward compat) ---
    const rules = interceptRules.get(tabId) || [];
    const matched = rules.find((rule) => {
      try {
        return new RegExp(rule.urlPattern).test(url);
      } catch {
        return false;
      }
    });

    if (matched && matched.response) {
      const resp = matched.response;
      const headers = Object.entries(resp.headers || {}).map(([n, v]) => ({
        name: n,
        value: String(v),
      }));
      if (!headers.find((h) => h.name.toLowerCase() === "content-type")) {
        headers.push({ name: "content-type", value: "application/json" });
      }
      chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: resp.status || 200,
        responseHeaders: headers,
        body: btoa(
          unescape(
            encodeURIComponent(
              typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body),
            ),
          ),
        ),
      });
      pushEvent("net.intercepted", tabId, { url, action: "mock" });
    } else {
      chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
        requestId: params.requestId,
      });
    }
  }

  // ─ Console events ─
  if (method === "Runtime.consoleAPICalled") {
    const buf = consoleBuffers.get(tabId);
    if (!buf) return;
    const entry = {
      level: params.type,
      args: params.args.map((a) =>
        a.value !== undefined ? a.value : a.description || `[${a.type}]`,
      ),
      ts: Math.round(params.timestamp),
      source: params.stackTrace?.callFrames?.[0]?.url,
    };
    buf.push(entry);
    pushEvent("console", tabId, entry);
  }

  if (method === "Runtime.exceptionThrown") {
    const buf = consoleBuffers.get(tabId);
    if (!buf) return;
    const ex = params.exceptionDetails;
    const entry = {
      level: "exception",
      text: ex?.text,
      description: ex?.exception?.description,
      ts: Math.round(params.timestamp),
      line: ex?.lineNumber,
      url: ex?.url,
    };
    buf.push(entry);
    pushEvent("console.exception", tabId, entry);
  }
});

// ── Popup Communication ──────────────────────────────────────
// Handles messages from popup.html to query state and control features.
// Adding support for a new module? Add a case in handlePopupMessage().
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handlePopupMessage(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }));
  return true; // async response
});

async function handlePopupMessage(msg) {
  switch (msg.type) {
    case "getState":
      return await buildPopupState();
    case "proxyStop":
      return await HANDLERS.proxy_stop({ tabId: msg.tabId });
    case "proxyClearLog":
      return await HANDLERS.proxy_clear_log({ tabId: msg.tabId });
    case "proxyUpdate":
      return await HANDLERS.proxy_update({ tabId: msg.tabId, rules: msg.rules });
    case "proxyUpdateRules": {
      // Update rules in extension state
      const result = await HANDLERS.proxy_update({ tabId: msg.tabId, rules: msg.rules });
      // Store whistle text alongside rules
      const pState = proxyState.get(msg.tabId);
      if (pState && msg.whistleText !== undefined) {
        pState.whistleText = msg.whistleText;
      }
      // Also notify server to persist the change
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
      const result = await HANDLERS.proxy_start({ tabId: msg.tabId, rules });
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

async function buildPopupState() {
  const connected = ws && ws.readyState === WebSocket.OPEN;

  // Collect all tabs with active features
  const activeTabIds = new Set([
    ...networkBuffers.keys(),
    ...consoleBuffers.keys(),
    ...interceptRules.keys(),
    ...proxyState.keys(),
  ]);

  const featureTabs = [];
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

  // Get browser tabs for display names
  let browserTabs = [];
  try {
    const allTabs = await chrome.tabs.query({});
    browserTabs = allTabs.map((t) => ({
      tabId: t.id,
      url: t.url,
      title: t.title,
      active: t.active,
    }));
  } catch {}

  // Global proxy state (aggregated from all _global tabs)
  let globalProxyState = null;
  if (globalProxy) {
    globalProxyState = {
      active: true,
      paused: !!globalProxy.paused,
      rules: globalProxy.rules,
      whistleText: globalProxy.whistleText || "",
      tabCount: [...proxyState.entries()].filter(([, st]) => st._global).length,
      log: [],
    };
    for (const [, st] of proxyState.entries()) {
      if (st._global && st.log) {
        globalProxyState.log.push(...st.log);
      }
    }
    globalProxyState.log.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }

  return { connected, tabs: featureTabs, browserTabs, globalProxy: globalProxyState, commandHistory: [...commandHistory] };
}

// ── Cleanup ──────────────────────────────────────────────────
chrome.debugger.onDetach.addListener((source) => {
  const tabId = source.tabId;
  debuggerTabs.delete(tabId);
  networkBuffers.delete(tabId);
  consoleBuffers.delete(tabId);
  interceptRules.delete(tabId);
  proxyState.delete(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  debuggerTabs.delete(tabId);
  networkBuffers.delete(tabId);
  consoleBuffers.delete(tabId);
  interceptRules.delete(tabId);
  proxyState.delete(tabId);
});

// ── Lifecycle ────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "reconnect" || alarm.name === "keepalive") {
    if (!ws || ws.readyState !== WebSocket.OPEN) connect();
  }
});

chrome.runtime.onInstalled.addListener(() => connect());
chrome.runtime.onStartup.addListener(() => connect());

// ── Tab Listeners (Global Proxy Auto-Attach) ──────────────────
// Attach as early as possible: on 'loading' status when URL is known.
// Also try on 'complete' as fallback (some tabs skip loading event).
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!globalProxy) return;
  if (proxyState.has(tabId)) return; // already attached
  // Attach when URL becomes available and navigation starts
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
});

// Also attach on tab creation (catches tabs opened via window.open, ctrl+click, etc.)
chrome.tabs.onCreated.addListener((tab) => {
  if (!globalProxy) return;
  // New tabs may start as about:blank, attach early — Fetch.enable will catch subsequent navigation
  if (tab.id) {
    // Delay slightly to let Chrome assign the pending URL
    setTimeout(() => attachGlobalProxy(tab.id), 100);
  }
});

connect();
