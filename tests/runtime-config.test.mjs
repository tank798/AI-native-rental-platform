import assert from "node:assert/strict";
import test from "node:test";

import { readRuntimeConfig } from "../src/server/runtime-config.mjs";

test("运行时默认使用真实市场模式", () => {
  const config = readRuntimeConfig({});

  assert.equal(config.marketMode, "real");
  assert.equal(config.demoBanner, false);
  assert.equal(config.aiEnabled, false);
  assert.equal(config.databasePath, null);
  assert.equal(config.uploadDirectory, null);
});

test("显式演示模式会打开持续可见的演示标识", () => {
  const config = readRuntimeConfig({
    MARKET_MODE: "demo",
    SILICONFLOW_API_KEY_FILE: "/private/example-key.txt",
    RENTAL_DATABASE_PATH: "/private/example.sqlite",
    RENTAL_UPLOAD_DIRECTORY: "/private/example-uploads"
  });

  assert.equal(config.marketMode, "demo");
  assert.equal(config.demoBanner, true);
  assert.equal(config.aiEnabled, true);
  assert.equal(config.databasePath, "/private/example.sqlite");
  assert.equal(config.uploadDirectory, "/private/example-uploads");
});

test("未知市场模式会在启动前被拒绝", () => {
  assert.throws(
    () => readRuntimeConfig({ MARKET_MODE: "mixed" }),
    /MARKET_MODE 只能是 real 或 demo/
  );
});

