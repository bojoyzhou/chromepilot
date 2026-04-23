import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "ChromePilot",
  version: "0.5.4",
  minimum_chrome_version: "114",
  description:
    "AI agent pilot for real Chrome: JS execution, network capture, cookies, console, and more",
  permissions: [
    "scripting",
    "tabs",
    "alarms",
    "debugger",
    "cookies",
    "proxy",
    "sidePanel",
    "storage",
  ],
  host_permissions: ["<all_urls>"],
  side_panel: {
    default_path: "src/extension/popup/index.html",
  },
  background: {
    service_worker: "src/extension/background/index.ts",
    type: "module",
  },
  action: {
    default_icon: {
      "16": "icons/icon16_gray.png",
      "32": "icons/icon32_gray.png",
      "48": "icons/icon48_gray.png",
      "128": "icons/icon128_gray.png",
    },
    default_title: "ChromePilot — Open Side Panel",
  },
  icons: {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
});
