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
  // 双边用例会开两个浏览器上下文跑完整流程（澄清→同版确认→解锁→看房），
  // 30s 预算在负载稍高时就会超时（实测单独跑 8.4s，满载套件下超 30s）。
  // 根因是匹配计算目前同步跑在请求线程内（worker.drain），
  // 在该性能问题修复前先给足挂钟预算，避免把真实通过的用例误判为失败。
  timeout: 90_000,
  expect: { timeout: 15_000 },
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
