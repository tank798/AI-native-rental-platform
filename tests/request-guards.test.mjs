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
  assert.doesNotThrow(() => assertSameOrigin({ headers: { host: "127.0.0.1:4173" } }));
});
