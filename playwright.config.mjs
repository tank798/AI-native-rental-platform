import os from "node:os";
import path from "node:path";
import process from "node:process";

import { defineConfig, devices } from "@playwright/test";

// 逐步降级的浏览器来源：默认用 Playwright 自带的 Chromium；
// 在无法下载自带浏览器的受限网络（内网 CI、代理环境）里，
// 允许通过 PLAYWRIGHT_EXECUTABLE_PATH 指向系统已装的 Chrome/Chromium。
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
const launchOptions = executablePath
  ? { executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] }
  : undefined;

export default defineConfig({
  testDir: "./tests",
  testMatch: ["ui-critical.spec.mjs", "bilateral-e2e.spec.mjs"],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: path.join(os.tmpdir(), "zhunaer-playwright-results"),
  reporter: [["line"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 414, height: 896 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    ...(launchOptions ? { launchOptions } : {})
  }
});
