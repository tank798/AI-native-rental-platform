import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRentalServer } from "../server.mjs";
import { testContactEncryptionKey } from "./test-secrets.mjs";

const validModelResponse = {
  choices: [{
    message: {
      content: JSON.stringify({
        renters: [{
          city: "上海",
          locations: ["静安寺"],
          budget: { target: 3_000, max: 3_500 },
          move_in: { from: "2026-09-01", to: "2026-09-08" },
          max_commute_minutes: 40,
          housing: { shared: true, roommate_gender: "female" },
          hard: { elevator: true, kitchen: true, washer: true },
          clarifying_questions: []
        }]
      })
    }
  }]
};

const relaxedPolicy = {
  sessionIpMinute: { limit: 20, windowMs: 60_000 },
  writeIpMinute: { limit: 20, windowMs: 60_000 },
  writeProfileMinute: { limit: 20, windowMs: 60_000 },
  writeProfileDay: { limit: 20, windowMs: 86_400_000 },
  aiIpMinute: { limit: 20, windowMs: 60_000 },
  aiSessionMinute: { limit: 20, windowMs: 60_000 },
  aiProfileHour: { limit: 20, windowMs: 3_600_000 },
  aiProfileDay: { limit: 20, windowMs: 86_400_000 },
  aiGlobalDay: { limit: 20, windowMs: 86_400_000 }
};

async function startTestApp(t, { policy }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-rate-http-"));
  let providerCalls = 0;
  const app = createRentalServer({
    databasePath: path.join(tempDir, "rental.sqlite"),
    uploadRoot: path.join(tempDir, "uploads"),
    enableScheduler: false,
    contactEncryptionKey: testContactEncryptionKey(),
    aiApiKey: "test-key",
    rateLimitPolicy: policy,
    aiClientOptions: {
      sleep: async () => {},
      fetchImpl: async () => {
        providerCalls += 1;
        return new Response(JSON.stringify(validModelResponse), { status: 200 });
      }
    }
  });
  let address;
  try {
    address = await app.listen(0);
  } catch (error) {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
    if (error.code === "EPERM") return null;
    throw error;
  }
  t.after(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    providerCalls: () => providerCalls
  };
}

async function createSession(baseUrl) {
  const response = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  return {
    payload,
    cookie: String(response.headers.get("set-cookie") || "").split(";", 1)[0]
  };
}

function intake(baseUrl, cookie, origin = null) {
  return fetch(`${baseUrl}/api/intake/renter`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...(origin ? { Origin: origin } : {})
    },
    body: JSON.stringify({ text: "静安寺找房，预算 3500", referenceDate: "2026-08-30" })
  });
}

test("AI profile 超额返回 429，不增加 provider 调用", async (t) => {
  const started = await startTestApp(t, {
    policy: { ...relaxedPolicy, aiProfileDay: { limit: 1, windowMs: 86_400_000 } }
  });
  if (!started) return t.skip("当前沙箱禁止监听本机端口");

  const session = await createSession(started.baseUrl);
  const first = await intake(started.baseUrl, session.cookie);
  assert.equal(first.status, 200);
  assert.equal(started.providerCalls(), 1);

  const denied = await intake(started.baseUrl, session.cookie);
  assert.equal(denied.status, 429);
  assert.equal((await denied.json()).code, "RATE_LIMITED");
  assert.ok(Number(denied.headers.get("retry-after")) >= 1);
  assert.equal(started.providerCalls(), 1);
});

test("AI 全局日预算熔断后走可审计规则降级", async (t) => {
  const started = await startTestApp(t, {
    policy: { ...relaxedPolicy, aiGlobalDay: { limit: 1, windowMs: 86_400_000 } }
  });
  if (!started) return t.skip("当前沙箱禁止监听本机端口");

  const session = await createSession(started.baseUrl);
  assert.equal((await intake(started.baseUrl, session.cookie)).status, 200);
  const degraded = await intake(started.baseUrl, session.cookie);
  const payload = await degraded.json();

  assert.equal(degraded.status, 200);
  assert.equal(payload.provider, "deterministic");
  assert.equal(payload.warningCode, "AI_DEGRADED");
  assert.equal(started.providerCalls(), 1);
});

test("超大请求与不同源 Cookie 请求在调用 provider 前被拒绝", async (t) => {
  const started = await startTestApp(t, { policy: relaxedPolicy });
  if (!started) return t.skip("当前沙箱禁止监听本机端口");

  const session = await createSession(started.baseUrl);
  const tooLarge = await fetch(`${started.baseUrl}/api/intake/renter`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: session.cookie },
    body: JSON.stringify({ text: "房".repeat(70_000), referenceDate: "2026-08-30" })
  });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).code, "REQUEST_TOO_LARGE");

  const denied = await intake(started.baseUrl, session.cookie, "https://evil.example");

  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "ORIGIN_MISMATCH");
  assert.equal(started.providerCalls(), 0);
});
