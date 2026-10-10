import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const host = "127.0.0.1";

/**
 * Chromium-only demo coverage. The suite never starts a daemon, coding agent,
 * or hosted model. CI builds `dist/` first and only runs the preview server.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://${host}:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 440, height: 956 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 440, height: 956 } },
    },
  ],
  webServer: {
    command: process.env.CI
      ? `npm run preview -- --host ${host} --port ${port} --strictPort`
      : `npm run build && npm run preview -- --host ${host} --port ${port} --strictPort`,
    url: `http://${host}:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
