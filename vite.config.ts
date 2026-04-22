import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./src/extension/manifest";

export default defineConfig({
  plugins: [crx({ manifest })],
  publicDir: "public",
  build: {
    outDir: "extension",
    // Keep build outputs in extension/ for "Load unpacked".
    emptyOutDir: false,
  },
});
