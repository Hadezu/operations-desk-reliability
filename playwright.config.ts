import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  metadata: { expectsWorkerReport: process.env.EXPECT_REPORT === "1" },
  reporter: [["list"], ["json", { outputFile: "evidence/playwright.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "npm run api",
          url: "http://localhost:3101/api/health",
          reuseExistingServer: !process.env.CI,
          timeout: 30000,
        },
        {
          command: "node --import tsx scripts/serve-web.ts",
          url: "http://localhost:3100",
          reuseExistingServer: !process.env.CI,
          timeout: 30000,
        },
      ],
});
