import assert from "node:assert/strict";
import test from "node:test";

import { SiliconFlowClient } from "../src/ai/siliconflow-client.mjs";

test("模型客户端默认 20 秒超时且只重试一次可恢复错误", async () => {
  let calls = 0;
  const client = new SiliconFlowClient({
    apiKey: "test-key",
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("temporary provider details", { status: 503 });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "{\"ok\":true}" } }],
        usage: { total_tokens: 3 }
      }), { status: 200 });
    }
  });

  assert.equal(client.timeoutMs, 20_000);
  assert.deepEqual(await client.json({ stage: "test", system: "system", user: "user" }), { ok: true });
  assert.equal(calls, 2);
});

test("provider 原始错误不会出现在对外异常", async () => {
  const client = new SiliconFlowClient({
    apiKey: "test-key",
    fetchImpl: async () => new Response("secret provider body", { status: 400 })
  });

  await assert.rejects(
    () => client.json({ stage: "test", system: "system", user: "user" }),
    (error) => error.code === "AI_PROVIDER_ERROR" && !error.message.includes("secret provider body")
  );
});

test("坏 JSON 只触发一次格式修复重试，调用记录有界", async () => {
  let calls = 0;
  const client = new SiliconFlowClient({
    apiKey: "test-key",
    sleep: async () => {},
    maxCallRecords: 3,
    fetchImpl: async (_url, options) => {
      calls += 1;
      const request = JSON.parse(options.body);
      if (calls === 1) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 });
      }
      if (calls === 2) assert.match(request.messages[0].content, /上一次响应不是有效 JSON/);
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"fixed\":true}" } }] }), { status: 200 });
    }
  });

  assert.deepEqual(await client.json({ stage: "repair", system: "system", user: "user" }), { fixed: true });
  await client.json({ stage: "two", system: "system", user: "user" });
  await client.json({ stage: "three", system: "system", user: "user" });
  await client.json({ stage: "four", system: "system", user: "user" });

  assert.equal(client.calls.length, 3);
});
