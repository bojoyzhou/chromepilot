// Command router — central dispatch + tab resolution
// Extracted from legacy.ts

import { sessions } from "./session/session-state";
import { commandHistory, MAX_COMMAND_HISTORY, proxyState } from "./shared-state";
import { send } from "./ws-bridge";
import { handleNetworkEvent } from "./cdp-dispatcher/network-events";
import { handleFetchEvent } from "./cdp-dispatcher/fetch-interceptor";
import { handleConsoleEvent } from "./cdp-dispatcher/console-events";
import { handlePageEvent } from "./cdp-dispatcher/page-events";

// Import all handler objects
import { tabHandlers } from "./handlers/tab-handlers";
import { networkHandlers } from "./handlers/network-handlers";
import { proxyHandlers } from "./handlers/proxy-handlers";
import { consoleHandlers } from "./handlers/console-handlers";
import { cookieHandlers } from "./handlers/cookie-handlers";
import { screenshotHandlers } from "./handlers/screenshot-handler";
import { sessionHandlers } from "./session/session-handlers";

// ── Tab Resolution ──
export async function resolveTabId(cmd: any): Promise<number | undefined> {
  if (cmd.sessionId) {
    const session = sessions.get(cmd.sessionId);
    if (!session) return undefined;
    if (session.status === "paused") return undefined;
    if (cmd.tabId) {
      if (!session.tabIds.includes(cmd.tabId)) return undefined;
      return cmd.tabId;
    }
    return session.tabIds[0] || undefined;
  }
  if (cmd.tabId) return cmd.tabId;
  if (cmd.urlMatch) {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((t) => t.url && t.url.includes(cmd.urlMatch));
    if (match) return match.id;
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active?.id;
}

// ── Assembled HANDLERS map ──
const HANDLERS: Record<string, (cmd: any) => Promise<any>> = {
  ...tabHandlers,
  ...networkHandlers,
  ...proxyHandlers,
  ...consoleHandlers,
  ...cookieHandlers,
  ...screenshotHandlers,
  ...sessionHandlers,
};

// ── Command Handler ──
export async function handleCommand(cmd: any): Promise<void> {
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
    if (cmd.sessionId) {
      const session = sessions.get(cmd.sessionId);
      if (session) session.lastCommandAt = Date.now();
    }
    const result = await handler(cmd);
    send({ id, ...result });
  } catch (e: any) {
    send({ id, error: e.message });
  }
}

// ── CDP Event Dispatcher ──
export function registerCdpDispatcher(): void {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId!;

    // Network events
    if (method.startsWith("Network.")) {
      if (handleNetworkEvent(tabId, method, params)) return;
    }

    // Fetch interception
    if (method === "Fetch.requestPaused") {
      handleFetchEvent(tabId, params);
      return;
    }

    // Console events
    if (method.startsWith("Runtime.")) {
      if (handleConsoleEvent(tabId, method, params)) return;
    }

    // Page events
    if (method.startsWith("Page.")) {
      handlePageEvent(tabId, method, params);
    }
  });
}
