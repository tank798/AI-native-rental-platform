import assert from "node:assert/strict";
import test from "node:test";

import { startTestServer } from "./helpers/start-test-server.mjs";

// ---------------------------------------------------------------------------
// real 模式闭环阻断项回归。
//
// verifiedDraft() 会丢弃客户端声明的核验状态，只采纳服务端已持久化的审核记录；
// 而 verificationReady() 要求四类材料全部 verified，否则 pair-evaluator 判
// SUPPLY_NOT_VERIFIED 硬冲突。此前 reviewEvidence 只能在测试进程内调用，
// 没有任何 HTTP 入口，因此 real 模式下没人能把材料审成 verified，
// 出租任务永远无法进入可匹配状态 —— 整个双边闭环实际不可达。
// ---------------------------------------------------------------------------

async function request(baseUrl, route, { method = "GET", body, headers = {}, cookie } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { response, payload };
}

async function createSession(baseUrl) {
  const { response } = await request(baseUrl, "/api/session", { method: "POST", body: {} });
  assert.equal(response.status, 201);
  return String(response.headers.get("set-cookie") || "").split(";", 1)[0];
}

async function uploadEvidence(baseUrl, cookie) {
  // 1x1 PNG
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  const { response, payload } = await request(baseUrl, "/api/evidence", {
    method: "POST",
    cookie,
    body: { kind: "identity", filename: "id.png", mimeType: "image/png", data: png }
  });
  assert.equal(response.status, 201, `上传失败：${JSON.stringify(payload)}`);
  return payload.id;
}

test("未配置 ADMIN_REVIEW_TOKEN 时核验端点不存在，默认部署不暴露入口", async (t) => {
  const started = await startTestServer();
  t.after(() => started.close());
  const cookie = await createSession(started.baseURL);
  const evidenceId = await uploadEvidence(started.baseURL, cookie);

  const { response, payload } = await request(started.baseURL, `/api/admin/evidence/${evidenceId}/review`, {
    method: "POST",
    cookie,
    body: { reviewer: "someone", result: "approved" }
  });
  assert.equal(response.status, 404);
  assert.equal(payload.code, "API_NOT_FOUND");
});

test("配置令牌后：无令牌或错误令牌不得改变核验事实", async (t) => {
  const started = await startTestServer({ adminReviewToken: "review-secret-token" });
  t.after(() => started.close());
  const cookie = await createSession(started.baseURL);
  const evidenceId = await uploadEvidence(started.baseURL, cookie);

  // 用户拿自己的会话直接审核自己的材料 —— 必须被拒
  const noToken = await request(started.baseURL, `/api/admin/evidence/${evidenceId}/review`, {
    method: "POST",
    cookie,
    body: { reviewer: "self", result: "approved" }
  });
  assert.equal(noToken.response.status, 403);
  assert.equal(noToken.payload.code, "REVIEW_FORBIDDEN");

  const wrongToken = await request(started.baseURL, `/api/admin/evidence/${evidenceId}/review`, {
    method: "POST",
    headers: { "X-Admin-Review-Token": "wrong-token" },
    body: { reviewer: "attacker", result: "approved" }
  });
  assert.equal(wrongToken.response.status, 403);

  // 确认材料仍未通过
  const status = await request(started.baseURL, `/api/evidence/${evidenceId}`, { cookie });
  assert.equal(status.response.status, 200);
  assert.notEqual(status.payload.verificationStatus, "verified", "错误令牌不得使材料变为 verified");
});

test("持有令牌的审核方可以通过或驳回材料，且参数经过校验", async (t) => {
  const started = await startTestServer({ adminReviewToken: "review-secret-token" });
  t.after(() => started.close());
  const cookie = await createSession(started.baseURL);
  const evidenceId = await uploadEvidence(started.baseURL, cookie);
  const auth = { "X-Admin-Review-Token": "review-secret-token" };

  // 缺少审核人
  const noReviewer = await request(started.baseURL, `/api/admin/evidence/${evidenceId}/review`, {
    method: "POST", headers: auth, body: { result: "approved" }
  });
  assert.equal(noReviewer.response.status, 422);
  assert.equal(noReviewer.payload.code, "REVIEWER_REQUIRED");

  // 非法结果
  const badResult = await request(started.baseURL, `/api/admin/evidence/${evidenceId}/review`, {
    method: "POST", headers: auth, body: { reviewer: "risk-ops", result: "maybe" }
  });
  assert.equal(badResult.response.status, 422);
  assert.equal(badResult.payload.code, "REVIEW_RESULT_INVALID");

  // 不存在的材料
  const missing = await request(started.baseURL, "/api/admin/evidence/not-exist/review", {
    method: "POST", headers: auth, body: { reviewer: "risk-ops", result: "approved" }
  });
  assert.equal(missing.response.status, 404);

  // 正常通过
  const approved = await request(started.baseURL, `/api/admin/evidence/${evidenceId}/review`, {
    method: "POST", headers: auth, body: { reviewer: "risk-ops", result: "approved" }
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.payload));
  assert.equal(approved.payload.status.verificationStatus, "verified");

  // 材料所有者能读到已通过状态
  const status = await request(started.baseURL, `/api/evidence/${evidenceId}`, { cookie });
  assert.equal(status.payload.verificationStatus, "verified");
});

test("驳回会被记录，且不产生 verified 事实", async (t) => {
  const started = await startTestServer({ adminReviewToken: "review-secret-token" });
  t.after(() => started.close());
  const cookie = await createSession(started.baseURL);
  const evidenceId = await uploadEvidence(started.baseURL, cookie);

  const rejected = await request(started.baseURL, `/api/admin/evidence/${evidenceId}/review`, {
    method: "POST",
    headers: { "X-Admin-Review-Token": "review-secret-token" },
    body: { reviewer: "risk-ops", result: "rejected" }
  });
  assert.equal(rejected.response.status, 200);
  assert.notEqual(rejected.payload.status.verificationStatus, "verified");
});
