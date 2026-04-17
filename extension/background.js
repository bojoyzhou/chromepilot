// ChromePilot Extension v2 — Service Worker (Manifest V3)
// Full-featured AI pilot: JS execution, network capture, cookies, console, screenshots
//
// Architecture: CLI → HTTP → server.py → WebSocket → this extension → Chrome APIs
// Key advantage: executeScript runs in MAIN world = page context + login session

const DEFAULT_WS = "ws://127.0.0.1:8787/ws";
let ws = null;
let wsUrl = DEFAULT_WS;

// ── Icon State ────────────────────────────────────────────────
function setIconConnected() {
  chrome.action.setIcon({
    path: { "16": "icon16.png", "32": "icon32.png", "48": "icon48.png", "128": "icon128.png" },
  });
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setTitle({ title: "ChromePilot — Connected" });
}

function setIconDisconnected() {
  chrome.action.setIcon({
    path: { "16": "icon16_gray.png", "32": "icon32_gray.png", "48": "icon48_gray.png", "128": "icon128_gray.png" },
  });
  chrome.action.setBadgeText({ text: "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: "#EA4335" });
  chrome.action.setTitle({ title: "ChromePilot — Disconnected" });
}

// Start with disconnected state
setIconDisconnected();

// ── State ────────────────────────────────────────────────────
const networkBuffers = new Map();   // tabId → [request entries]
const consoleBuffers = new Map();   // tabId → [console entries]
const debuggerTabs   = new Set();   // tabs with debugger attached
const interceptRules = new Map();   // tabId → [rules]
const pendingBodies  = new Map();   // tabId → Map(requestId → {resolve, timer})

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
      try { handleCommand(JSON.parse(event.data)); }
      catch (e) { console.error("[chromepilot] Parse error:", e); }
    };
    ws.onclose = () => {
      ws = null;
      setIconDisconnected();
      chrome.alarms.create("reconnect", { delayInMinutes: 0.05 });
    };
    ws.onerror = () => { ws = null; setIconDisconnected(); };
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
    const match = tabs.find(t => t.url && t.url.includes(cmd.urlMatch));
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
    return false;
  }
}

async function detachDebugger(tabId) {
  if (!debuggerTabs.has(tabId)) return;
  try { await chrome.debugger.detach({ tabId }); } catch {}
  debuggerTabs.delete(tabId);
}

// Check if debugger is still needed for this tab
function debuggerStillNeeded(tabId) {
  return networkBuffers.has(tabId) || consoleBuffers.has(tabId) || interceptRules.has(tabId);
}

// ── Command Router ───────────────────────────────────────────
async function handleCommand(cmd) {
  const id = cmd.id;
  if (!id) return; // ignore events echoed back

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
  async ping() { return { pong: true }; },

  // -- Tabs --
  async list_tabs() {
    const tabs = await chrome.tabs.query({});
    return {
      data: tabs.map(t => ({
        tabId: t.id, url: t.url, title: t.title,
        active: t.active, windowId: t.windowId,
        status: t.status, incognito: t.incognito,
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
        try { return eval(expr); }
        catch (e) { return { __error__: e.message, __stack__: e.stack }; }
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
    if (!await ensureDebugger(tabId)) {
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
      reqs = reqs.filter(r => re.test(r.url));
    }
    if (cmd.method) {
      reqs = reqs.filter(r => r.method === cmd.method.toUpperCase());
    }
    if (cmd.status) {
      reqs = reqs.filter(r => r.statusCode === cmd.status);
    }
    if (cmd.type) {
      reqs = reqs.filter(r => r.type === cmd.type);
    }
    // Only completed
    if (cmd.completed) {
      reqs = reqs.filter(r => r.statusCode != null);
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
      const result = await chrome.debugger.sendCommand(
        { tabId }, "Network.getResponseBody", { requestId: cmd.requestId }
      );
      return { body: result.body, base64Encoded: result.base64Encoded };
    } catch (e) {
      return { error: `Cannot get body: ${e.message}` };
    }
  },

  // -- Network Intercept --
  async network_intercept(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    if (!await ensureDebugger(tabId)) {
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
    try {
      await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
    } catch {}
    if (!debuggerStillNeeded(tabId)) await detachDebugger(tabId);
    return { ok: true };
  },

  // -- Console --
  async console_start(cmd) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };
    if (!await ensureDebugger(tabId)) {
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
    if (cmd.level) msgs = msgs.filter(m => m.level === cmd.level);
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
      await new Promise(r => setTimeout(r, 300));
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
          domContentLoaded: Math.round(performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart),
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
    const entry = buf.find(r => r.requestId === params.requestId);
    if (entry) {
      entry.statusCode = params.response.status;
      entry.statusText = params.response.statusText;
      entry.responseHeaders = params.response.headers;
      entry.mimeType = params.response.mimeType;
      entry.remoteAddr = params.response.remoteIPAddress;
      entry.protocol = params.response.protocol;
      pushEvent("net.response", tabId, {
        url: entry.url, status: entry.statusCode, mimeType: entry.mimeType,
      });
    }
  }

  if (method === "Network.loadingFinished") {
    const buf = networkBuffers.get(tabId);
    if (!buf) return;
    const entry = buf.find(r => r.requestId === params.requestId);
    if (entry) {
      entry.size = params.encodedDataLength;
      entry.done = true;
    }
  }

  if (method === "Network.loadingFailed") {
    const buf = networkBuffers.get(tabId);
    if (!buf) return;
    const entry = buf.find(r => r.requestId === params.requestId);
    if (entry) {
      entry.error = params.errorText;
      entry.canceled = params.canceled;
      entry.done = true;
    }
  }

  // ─ Fetch interception ─
  if (method === "Fetch.requestPaused") {
    const rules = interceptRules.get(tabId) || [];
    const matched = rules.find(rule => {
      try { return new RegExp(rule.urlPattern).test(params.request.url); }
      catch { return false; }
    });

    if (matched && matched.response) {
      const resp = matched.response;
      const headers = Object.entries(resp.headers || {}).map(([n, v]) => ({ name: n, value: String(v) }));
      if (!headers.find(h => h.name.toLowerCase() === "content-type")) {
        headers.push({ name: "content-type", value: "application/json" });
      }
      chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: resp.status || 200,
        responseHeaders: headers,
        body: btoa(unescape(encodeURIComponent(typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body)))),
      });
      pushEvent("net.intercepted", tabId, { url: params.request.url, action: "mock" });
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
      args: params.args.map(a =>
        a.value !== undefined ? a.value :
        a.description || `[${a.type}]`
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

// ── Cleanup ──────────────────────────────────────────────────
chrome.debugger.onDetach.addListener((source) => {
  const tabId = source.tabId;
  debuggerTabs.delete(tabId);
  networkBuffers.delete(tabId);
  consoleBuffers.delete(tabId);
  interceptRules.delete(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  debuggerTabs.delete(tabId);
  networkBuffers.delete(tabId);
  consoleBuffers.delete(tabId);
  interceptRules.delete(tabId);
});

// ── Lifecycle ────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "reconnect" || alarm.name === "keepalive") {
    if (!ws || ws.readyState !== WebSocket.OPEN) connect();
  }
});

chrome.runtime.onInstalled.addListener(() => connect());
chrome.runtime.onStartup.addListener(() => connect());
connect();
