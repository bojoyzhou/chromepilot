function iconPath(name: string): string {
  return chrome.runtime.getURL(`icons/${name}`);
}

export function setIconConnected(): void {
  chrome.action
    .setIcon({
      path: {
        "16": iconPath("icon16.png"),
        "32": iconPath("icon32.png"),
        "48": iconPath("icon48.png"),
        "128": iconPath("icon128.png"),
      },
    })
    .catch((e: unknown) => console.error("[chromepilot] setIcon(connected) FAILED:", e));
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setTitle({ title: "ChromePilot — Connected" });
}

export function setIconDisconnected(): void {
  chrome.action
    .setIcon({
      path: {
        "16": iconPath("icon16_gray.png"),
        "32": iconPath("icon32_gray.png"),
        "48": iconPath("icon48_gray.png"),
        "128": iconPath("icon128_gray.png"),
      },
    })
    .catch((e: unknown) => console.error("[chromepilot] setIcon(disconnected) FAILED:", e));
  chrome.action.setBadgeText({ text: "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: "#EA4335" });
  chrome.action.setTitle({ title: "ChromePilot — Disconnected" });
}
