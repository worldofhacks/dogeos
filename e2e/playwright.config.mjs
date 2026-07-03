import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 8788);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const isExternalTarget = !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(BASE_URL);

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/playwright-report", open: "never" }],
  ],
  outputDir: "artifacts/test-results",
  use: {
    baseURL: BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: isExternalTarget
    ? undefined
    : {
        command: `npm run dev:web -- --host 127.0.0.1 --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "iphone-portrait",
      use: { ...devices["iPhone 14"], browserName: "chromium", viewport: { width: 390, height: 844 } },
    },
    {
      name: "iphone-landscape",
      use: { ...devices["iPhone 14 landscape"], browserName: "chromium", viewport: { width: 844, height: 390 } },
    },
    {
      name: "android-portrait",
      use: { ...devices["Pixel 7"], viewport: { width: 412, height: 915 } },
    },
    {
      name: "android-landscape",
      use: { ...devices["Pixel 7 landscape"], viewport: { width: 915, height: 412 } },
    },
  ],
});
