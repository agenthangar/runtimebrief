/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The daemon serves `dist/` from its own origin, so the app always talks to
// `/v1` on the page origin. In development, proxy that prefix to a local
// daemon (override with RUNTIMEBRIEF_DEV_PROXY) so the browser sees one origin.
const devProxyTarget = process.env.RUNTIMEBRIEF_DEV_PROXY ?? "http://127.0.0.1:8484";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/v1": { target: devProxyTarget, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**"],
    css: false,
  },
});
