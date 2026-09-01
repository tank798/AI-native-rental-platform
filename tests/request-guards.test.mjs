import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { assertJsonContentType, assertSameOrigin, readJson } from "../src/server/request-guards.mjs";

function requestFrom(chunks, headers = {}) {
  const request = Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
  request.headers = { "content-type": "application/json", ...headers };
  request.method = "POST";
  return request;
}

test("普通 JSON 请求在读取过程中超过 64KB 就停止", async () => {
  const request = requestFrom(["{" + "x".repeat(70_000) + "}"]);

  await assert.rejects(
    () => readJson(request, { limitBytes: 64 * 1024 }),
    (error) => error.status === 413 && error.code === "REQUEST_TOO_LARGE"
  );
});

test("JSON 解析错误和 Content-Type 错误使用稳定错误码", async () => {
  await assert.rejects(
    () => readJson(requestFrom(["{broken"])),
    (error) => error.status === 400 && error.code === "INVALID_JSON"
  );
  assert.throws(
    () => assertJsonContentType({ headers: { "content-type": "text/plain" } }),
    (error) => error.status === 415 && error.code === "UNSUPPORTED_MEDIA_TYPE"
  );
});

test("浏览器修改请求的 Origin 必须与当前 Host 一致", () => {
  assert.doesNotThrow(() => assertSameOrigin({
    headers: { origin: "https://rental.example", host: "rental.example", "x-forwarded-proto": "https" }
  }));
  assert.throws(
    () => assertSameOrigin({ headers: { origin: "https://evil.example", host: "rental.example", "x-forwarded-proto": "https" } }),
    (error) => error.status === 403 && error.code === "ORIGIN_MISMATCH"
  );
  // 旧行为：缺少 Origin 头直接放行，导致只要不带 Origin 就能绕过全部同源校验。
  // 真实浏览器对所有非 GET 请求必定携带 Origin，因此该豁免只会放行伪造请求。
  assert.throws(
    () => assertSameOrigin({ headers: { host: "127.0.0.1:4173" } }),
    (error) => error.status === 403 && error.code === "ORIGIN_REQUIRED"
  );
});

test("Sec-Fetch-Site 优先于 Origin，跳站写操作被拦住", () => {
  // 浏览器强制添加且脚本不可伪造
  assert.doesNotThrow(() => assertSameOrigin({
    headers: { "sec-fetch-site": "same-origin", host: "rental.example" }
  }));
  // 地址栗直接输入、书签等场景
  assert.doesNotThrow(() => assertSameOrigin({
    headers: { "sec-fetch-site": "none", host: "rental.example" }
  }));
  for (const site of ["cross-site", "same-site"]) {
    assert.throws(
      () => assertSameOrigin({ headers: { "sec-fetch-site": site, host: "rental.example" } }),
      (error) => error.status === 403 && error.code === "ORIGIN_MISMATCH",
      site
    );
  }
});

test("无 Origin 时回退校验 Referer", () => {
  assert.doesNotThrow(() => assertSameOrigin({
    headers: { referer: "https://rental.example/tasks", host: "rental.example" }
  }));
  assert.throws(
    () => assertSameOrigin({ headers: { referer: "https://evil.example/x", host: "rental.example" } }),
    (error) => error.status === 403 && error.code === "ORIGIN_MISMATCH"
  );
});
