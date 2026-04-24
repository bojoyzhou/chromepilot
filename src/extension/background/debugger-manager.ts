// Debugger lifecycle management
// Extracted from legacy.ts

import {
  debuggerTabs,
  networkBuffers,
  consoleBuffers,
  interceptRules,
  proxyState,
} from "./shared-state";
import { sessionOwnsTab } from "./session/session-state";

export async function ensureDebugger(tabId) {
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

export async function detachDebugger(tabId) {
  if (!debuggerTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* ignore detach errors */
  }
  debuggerTabs.delete(tabId);
}

export function debuggerStillNeeded(tabId) {
  return (
    networkBuffers.has(tabId) ||
    consoleBuffers.has(tabId) ||
    interceptRules.has(tabId) ||
    proxyState.has(tabId) ||
    sessionOwnsTab(tabId)
  );
}
