// Tab, evaluate, navigate handlers
// Extracted from legacy.ts HANDLERS

import { resolveTabId } from "../command-router";

export const tabHandlers = {
  async ping() {
    return { pong: true };
  },

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

  async navigate(cmd) {
    let tabId = cmd.tabId;
    if (tabId) {
      await chrome.tabs.update(tabId, { url: cmd.url });
    } else {
      const tab = await chrome.tabs.create({ url: cmd.url });
      tabId = tab.id;
    }
    if (cmd.waitForLoad) {
      await new Promise<void>((resolve) => {
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
};
