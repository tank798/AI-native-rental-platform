import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "ui-critical.spec.mjs",
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
    video: "off"
  }
});

