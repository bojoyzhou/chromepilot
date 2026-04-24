// WebSocket connection bridge
// Extracted from legacy.ts

import { setIconConnected, setIconDisconnected } from "./modules/icon-state";
import { sessions } from "./session/session-state";

const DEFAULT_WS = "ws://127.0.0.1:8787/ws";
let ws: WebSocket | null = null;
const wsUrl = DEFAULT_WS;

// Expose for external command handling
let onCommandReceived: ((cmd: any) => void) | null = null;

export function setCommandHandler(handler: (cmd: any) => void): void {
  onCommandReceived = handler;
}

export function connect(): void {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  try {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      console.log("[chromepilot] Connected to server");
      setIconConnected();
      chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
      // Sync session state to server on reconnect
      if (sessions.size > 0) {
        send({
          _event: true,
          type: "sessions.sync",
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
        });
      }
    };
    ws.onmessage = (event) => {
      try {
        if (onCommandReceived) onCommandReceived(JSON.parse(event.data));
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

export function send(data: any): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function pushEvent(type: string, tabId: number | null, data: any): void {
  send({ _event: true, type, tabId, data, ts: Date.now() });
}

export function isConnected(): boolean {
  return !!ws && ws.readyState === WebSocket.OPEN;
}
