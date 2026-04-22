export function setIconConnected(): void {
  chrome.action.setIcon({
    path: {
      "16": "icon16.png",
      "32": "icon32.png",
      "48": "icon48.png",
      "128": "icon128.png",
    },
  });
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setTitle({ title: "ChromePilot — Connected" });
}

export function setIconDisconnected(): void {
  chrome.action.setIcon({
    path: {
      "16": "icon16_gray.png",
      "32": "icon32_gray.png",
      "48": "icon48_gray.png",
      "128": "icon128_gray.png",
    },
  });
  chrome.action.setBadgeText({ text: "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: "#EA4335" });
  chrome.action.setTitle({ title: "ChromePilot — Disconnected" });
}
