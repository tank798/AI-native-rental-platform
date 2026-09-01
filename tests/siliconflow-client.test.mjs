import assert from "node:assert/strict";
import test from "node:test";

import { SiliconFlowClient } from "../src/ai/siliconflow-client.mjs";

test("模型客户端默认基础超时 45 秒且只重试一次可恢复错误", async () => {
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

  // 20s 对单次结构化即偏紧（实测单租客 runtime 解析也会超时），已提高到 45s，
  // 并按 maxTokens 动态放大，见 timeoutFor()。
  assert.equal(client.timeoutMs, 45_000);
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

test("provider 429 与超时都只重试一次并返回净化错误且错误码可区分", async () => {
  let rateLimitCalls = 0;
  const rateLimited = new SiliconFlowClient({
    apiKey: "test-key",
    sleep: async () => {},
    random: () => 0,
    fetchImpl: async () => {
      rateLimitCalls += 1;
      return new Response("provider rate-limit details", { status: 429 });
    }
  });
  await assert.rejects(
    () => rateLimited.json({ stage: "rate-limit", system: "system", user: "user" }),
    (error) => error.code === "AI_PROVIDER_ERROR" && !error.message.includes("provider rate-limit details")
  );
  assert.equal(rateLimitCalls, 2);
  assert.equal(rateLimited.calls.at(-1).error_code, "HTTP_429");

  let timeoutCalls = 0;
  const timedOut = new SiliconFlowClient({
    apiKey: "test-key",
    sleep: async () => {},
    random: () => 0,
    fetchImpl: async () => {
      timeoutCalls += 1;
      // 真实环境里 TimeoutError 是 DOMException，其 .code 为数字 23。
      // 旧测试构造的假错误没带 code，恰好掩盖了 error_code 被写成 23 的缺陷。
      throw Object.assign(new Error("internal timeout details"), { name: "TimeoutError", code: 23 });
    }
  });
  await assert.rejects(
    () => timedOut.json({ stage: "timeout", system: "system", user: "user" }),
    (error) => error.code === "AI_PROVIDER_ERROR" && !error.message.includes("internal timeout details")
  );
  assert.equal(timeoutCalls, 2);
  // 超时必须记为可识别的 TIMEOUT，既不能是数字 23，也不该和通用错误混同，
  // 否则无法对超时单独告警或做成本归因。
  assert.equal(timedOut.calls.at(-1).error_code, "TIMEOUT");
});

// ---------------------------------------------------------------------------
// 回归：超时须可配置且随 maxTokens 放大；错误码不得写入无语义的数字。
// 旧实现 DEFAULT_TIMEOUT_MS = 20_000 硬编码且全链路无法配置，
// 实测单租客 runtime 解析也会超时（2 次尝试各 20s，共 40.7s 全败），
// 且 TimeoutError 是 DOMException、其 .code 为数字 23，
// 直接写入指标会得到 error_code: 23，破坏超时告警与成本归因。
// ---------------------------------------------------------------------------

test("超时按 maxTokens 动态放大，且可通过 timeoutMs 配置基础值", () => {
  const client = new SiliconFlowClient({ apiKey: "sk-test" });
  const short = client.timeoutFor(500);
  const long = client.timeoutFor(4096);
  assert.ok(long > short, "输出越长超时预算应越大");
  assert.ok(short >= 45_000, `基础超时应不低于 45s，实际 ${short}`);
  assert.ok(long <= 180_000, "不得超过 180s 上限");

  const custom = new SiliconFlowClient({ apiKey: "sk-test", timeoutMs: 10_000 });
  assert.ok(custom.timeoutFor(0) === 10_000, "应采用显式配置的基础超时");
  assert.ok(custom.timeoutFor(4096) < client.timeoutFor(4096), "配置更小的基础值应整体更小");
});

test("超时失败记录为 TIMEOUT，而不是 DOMException 的数字 code", async () => {
  const timeoutError = Object.assign(new Error("The operation was aborted due to timeout"), {
    name: "TimeoutError",
    code: 23
  });
  const client = new SiliconFlowClient({
    apiKey: "sk-test",
    timeoutMs: 5,
    fetchImpl: async () => { throw timeoutError; },
    sleep: async () => {}
  });
  await assert.rejects(
    () => client.json({ stage: "probe", system: "s", user: "u", maxTokens: 16 }),
    (error) => error.code === "AI_PROVIDER_ERROR"
  );
  const record = client.calls.at(-1);
  assert.equal(record.error_code, "TIMEOUT", `应记录为 TIMEOUT，实际 ${record.error_code}`);
  assert.notEqual(record.error_code, 23);
});

test("retries 参数真实生效，不再被硬顶为 2 次", async () => {
  let attempts = 0;
  const client = new SiliconFlowClient({
    apiKey: "sk-test",
    fetchImpl: async () => {
      attempts += 1;
      throw Object.assign(new Error("boom"), { name: "TimeoutError", code: 23 });
    },
    sleep: async () => {}
  });
  await assert.rejects(() => client.json({ stage: "probe", system: "s", user: "u", retries: 4 }));
  assert.equal(attempts, 4, `retries: 4 应实际尝试 4 次，实际 ${attempts}`);
});
