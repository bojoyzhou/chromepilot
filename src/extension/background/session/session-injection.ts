// Session tab injection utilities — chrome.scripting/debugger calls
// Extracted from legacy.ts

import { debuggerTabs } from "../shared-state";

export async function injectTitlePrefix(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (prefix: string) => {
        if (!document.title.startsWith(prefix)) {
          document.title = prefix + document.title;
        }
        if (!(window as any).__cpTitleObserver) {
          const target = document.querySelector("title") || document.head;
          if (target) {
            (window as any).__cpTitleObserver = new MutationObserver(() => {
              if (!document.title.startsWith(prefix)) {
                document.title = prefix + document.title;
              }
            });
            (window as any).__cpTitleObserver.observe(target, {
              childList: true,
              subtree: true,
              characterData: true,
            });
          }
        }
      },
      args: ["[A] "],
      world: "MAIN",
    });
  } catch {
    /* ignore injection errors on restricted pages */
  }
}

export async function removeTitlePrefix(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (prefix: string) => {
        if ((window as any).__cpTitleObserver) {
          (window as any).__cpTitleObserver.disconnect();
          (window as any).__cpTitleObserver = null;
        }
        if (document.title.startsWith(prefix)) {
          document.title = document.title.slice(prefix.length);
        }
      },
      args: ["[A] "],
      world: "MAIN",
    });
  } catch {
    /* ignore */
  }
}

export async function injectAgentSuppressors(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if ((window as any).__cpSuppressed) return;
        (window as any).__cpSuppressed = true;
        (window as any).Notification = class {
          constructor() {}
          static requestPermission() {
            return Promise.resolve("denied");
          }
        };
        window.focus = function () {};
        const origPlay = Audio.prototype.play;
        Audio.prototype.play = function (this: HTMLAudioElement) {
          this.muted = true;
          return origPlay.call(this);
        };
      },
      world: "MAIN",
    });
  } catch {
    /* ignore */
  }
}

export async function enableDialogAutoAccept(tabId: number): Promise<void> {
  if (!debuggerTabs.has(tabId)) return;
  try {
    await chrome.debugger.sendCommand({ tabId }, "Page.enable", {});
  } catch {
    /* ignore */
  }
}
