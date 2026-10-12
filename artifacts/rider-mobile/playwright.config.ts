import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";

const chromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();

export default defineConfig({
  testDir: "./e2e",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:23243",
    launchOptions: {
      executablePath: chromiumPath,
    },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:9 pnpm exec expo start --web --localhost --port 23243",
      url: "http://127.0.0.1:23243",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        "PORT=22969 BASE_PATH=/ pnpm --filter @workspace/rider-app run dev",
      url: "http://127.0.0.1:22969",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "android-small",
      testMatch: /(?:rider-mobile-capacity|wallet-milestones)\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        browserName: "chromium",
        viewport: { width: 320, height: 720 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "iphone-small",
      testMatch: /(?:rider-mobile-capacity|wallet-milestones)\.spec\.ts/,
      use: {
        ...devices["iPhone 12 Mini"],
        browserName: "chromium",
        viewport: { width: 320, height: 720 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "rider-web",
      testMatch: /rider-web-capacity\.spec\.ts/,
      use: {
        browserName: "chromium",
        baseURL: "http://127.0.0.1:22969",
        viewport: { width: 402, height: 874 },
        launchOptions: {
          executablePath: chromiumPath,
        },
      },
    },
  ],
});