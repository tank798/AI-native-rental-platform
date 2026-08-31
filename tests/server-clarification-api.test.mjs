import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRentalServer } from "../server.mjs";
import { createClock } from "../src/clock.mjs";
import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";
import { testContactEncryptionKey } from "./test-secrets.mjs";

async function request(baseUrl, route, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

async function session(baseUrl) {
  const { response, payload } = await request(baseUrl, "/api/session", { method: "POST", body: {} });
  return {
    ...payload,
    cookie: String(response.headers.get("set-cookie") || "").split(";", 1)[0]
  };
}

test("案例接口只给目标方问题，回答后自动重算且重复回答幂等", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-clarification-api-"));
  const clock = createClock({ now: () => new Date("2026-08-30T00:00:00.000Z") });
  const app = createRentalServer({
    databasePath: path.join(tempDir, "rental.sqlite"),
    uploadRoot: path.join(tempDir, "uploads"),
    enableScheduler: false,
    clock,
    contactEncryptionKey: testContactEncryptionKey()
  });
  let address;
  try {
    address = await app.listen(0);
  } catch (error) {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
    if (error.code === "EPERM") return t.skip("当前沙箱禁止监听本机端口；在可监听环境运行 HTTP 集成测试");
    throw error;
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const renter = await session(baseUrl);
  const supply = await session(baseUrl);
  const stranger = await session(baseUrl);
  app.repository.createTask({
    id: "renter-api",
    ownerId: renter.userId,
    kind: "renter",
    label: "静安寺",
    payload: { mandate: structuredClone(baseMandate), inputVersion: 1 },
    inputVersion: 1,
    expiresAt: "2026-09-29T00:00:00.000Z"
  });
  const draft = structuredClone(demoSupplyDraft);
  draft.facilities.kitchen = null;
  app.repository.createTask({
    id: "supply-api",
    ownerId: supply.userId,
    kind: "supply",
    label: "厨房待确认",
    payload: { draft, inputVersion: 1 },
    inputVersion: 1,
    expiresAt: "2026-09-29T00:00:00.000Z"
  });
  app.matching.processAfterTaskCreated("supply-api");
  const matchCase = app.matching.matchCaseRepository.findByPair("renter-api", "supply-api");
  const caseRoute = `/api/matches/${encodeURIComponent(matchCase.id)}`;

  const renterView = await request(baseUrl, caseRoute, { cookie: renter.cookie });
  assert.equal(renterView.response.status, 200);
  assert.equal(renterView.payload.matchCase.clarifications.questions.length, 0);
  assert.equal(renterView.payload.matchCase.clarifications.otherPendingCount, 1);
  assert.deepEqual(renterView.payload.matchCase.clarifications.otherPendingCategories, ["核心居住条件"]);

  const supplyView = await request(baseUrl, caseRoute, { cookie: supply.cookie });
  assert.equal(supplyView.payload.matchCase.clarifications.questions.length, 1);
  assert.equal(supplyView.payload.matchCase.clarifications.otherPendingCount, 0);
  assert.doesNotMatch(JSON.stringify(supplyView.payload), /minimumAuthorizedRent|rawText|最高预算|底价/);
  const clarificationId = supplyView.payload.matchCase.clarifications.questions[0].id;
  const answerRoute = `${caseRoute}/clarifications/${encodeURIComponent(clarificationId)}/answers`;

  assert.equal((await request(baseUrl, caseRoute, { cookie: stranger.cookie })).response.status, 404);
  assert.equal((await request(baseUrl, answerRoute, { cookie: renter.cookie, method: "POST", body: { answer: true } })).response.status, 404);
  assert.equal((await request(baseUrl, answerRoute, { cookie: supply.cookie, method: "POST", body: { answer: "maybe" } })).response.status, 422);

  const answered = await request(baseUrl, answerRoute, { cookie: supply.cookie, method: "POST", body: { answer: true } });
  assert.equal(answered.response.status, 200);
  assert.equal(answered.payload.answer.idempotent, false);
  assert.equal(answered.payload.matchCase.status, "terms_ready");
  assert.equal(answered.payload.matchCase.clarifications.questions.length, 0);

  const replay = await request(baseUrl, answerRoute, { cookie: supply.cookie, method: "POST", body: { answer: true } });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.payload.answer.idempotent, true);
  assert.equal((await request(baseUrl, answerRoute, { cookie: supply.cookie, method: "POST", body: { answer: false } })).response.status, 409);
});
