import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRentalServer } from "../server.mjs";

test("静态页面返回阻断脚本注入和嵌入的安全响应头", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-security-"));
  const app = createRentalServer({
    databasePath: path.join(tempDir, "rental.sqlite"),
    uploadRoot: path.join(tempDir, "uploads"),
    enableScheduler: false
  });
  let address;
  try {
    address = await app.listen(0);
  } catch (error) {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
    if (error.code === "EPERM") return t.skip("当前沙箱禁止监听本机端口；在可监听环境验证安全响应头");
    throw error;
  }
  t.after(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  const csp = response.headers.get("content-security-policy") || "";

  assert.equal(response.status, 200);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("permissions-policy") || "", /geolocation=\(\)/);
});

