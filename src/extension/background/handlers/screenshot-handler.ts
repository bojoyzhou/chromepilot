// Screenshot + page_info handlers
// Extracted from legacy.ts HANDLERS

import { ensureDebugger, detachDebugger, debuggerStillNeeded } from "../debugger-manager";
import { resolveTabId } from "../command-router";
import { findSessionByTab } from "../session/session-state";

export const screenshotHandlers = {
  async screenshot(cmd: any) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };

    const ok = await ensureDebugger(tabId);
    if (!ok) return { error: "Cannot attach debugger. Close DevTools for this tab first." };

    // Optional: set viewport
    if (cmd.width || cmd.height) {
      await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
        width: cmd.width || 1280,
        height: cmd.height || 800,
        deviceScaleFactor: cmd.deviceScaleFactor || 1,
        mobile: false,
      });
    }

    // Optional: wait for load
    if (cmd.waitForLoad) {
      await Promise.race([
        new Promise<void>((r) => {
          chrome.debugger.sendCommand({ tabId }, "Page.enable", {});
          const listener = (src: chrome.debugger.Debuggee, method: string) => {
            if (src.tabId === tabId && method === "Page.loadEventFired") {
              chrome.debugger.onEvent.removeListener(listener);
              r();
            }
          };
          chrome.debugger.onEvent.addListener(listener);
        }),
        new Promise<void>((r) => setTimeout(r, cmd.waitTimeout || 5000)),
      ]);
    }

    // CDP screenshot — no need to activate tab
    const result = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
      format: cmd.format || "png",
      quality: cmd.quality || 90,
    });

    // Clean up viewport override
    if (cmd.width || cmd.height) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride", {});
      } catch {
        /* ignore */
      }
    }

    // Don't detach debugger if session owns this tab
    if (!findSessionByTab(tabId) && !debuggerStillNeeded(tabId)) {
      await detachDebugger(tabId);
    }

    return { dataUrl: `data:image/${cmd.format || "png"};base64,${(result as any).data}` };
  },

  async page_info(cmd: any) {
    const tabId = await resolveTabId(cmd);
    if (!tabId) return { error: "No matching tab" };

    const tab = await chrome.tabs.get(tabId);
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
