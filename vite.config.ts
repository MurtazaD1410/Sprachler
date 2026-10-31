import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    rollupOptions: {
      // Pages the manifest doesn't name directly (opened by chrome.offscreen at runtime).
      input: { offscreen: "src/offscreen/index.html", wortschatz: "src/wortschatz/index.html" },
    },
  },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});
