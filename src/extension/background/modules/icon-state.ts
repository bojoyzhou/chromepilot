export function setIconConnected(): void {
  console.log("[chromepilot] setIconConnected called");
  chrome.action
    .setIcon({
      path: {
        "16": "icons/icon16.png",
        "32": "icons/icon32.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png",
      },
    })
    .then(() => console.log("[chromepilot] setIcon(connected) OK"))
    .catch((e: unknown) => console.error("[chromepilot] setIcon(connected) FAILED:", e));
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setTitle({ title: "ChromePilot — Connected" });
}

export function setIconDisconnected(): void {
  console.log("[chromepilot] setIconDisconnected called");
  chrome.action
    .setIcon({
      path: {
        "16": "icons/icon16_gray.png",
        "32": "icons/icon32_gray.png",
        "48": "icons/icon48_gray.png",
        "128": "icons/icon128_gray.png",
      },
    })
    .then(() => console.log("[chromepilot] setIcon(disconnected) OK"))
    .catch((e: unknown) => console.error("[chromepilot] setIcon(disconnected) FAILED:", e));
  chrome.action.setBadgeText({ text: "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: "#EA4335" });
  chrome.action.setTitle({ title: "ChromePilot — Disconnected" });
}
