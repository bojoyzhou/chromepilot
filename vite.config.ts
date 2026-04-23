import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import manifest from "./src/extension/manifest";

const buildTimeMs = Date.now();
const buildTimeIso = new Date(buildTimeMs).toISOString();

export default defineConfig({
  define: {
    __BUILD_TIME_ISO__: JSON.stringify(buildTimeIso),
    __BUILD_TIME_MS__: JSON.stringify(String(buildTimeMs)),
  },
  plugins: [react(), crx({ manifest })],
  publicDir: "public",
  build: {
    outDir: "extension",
    // Keep build outputs in extension/ for "Load unpacked".
    emptyOutDir: false,
  },
});
