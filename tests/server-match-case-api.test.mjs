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
  return { ...payload, cookie: String(response.headers.get("set-cookie") || "").split(";", 1)[0] };
}

test("任务案例 API 恢复服务端确认状态，第三方不可见且双方必须确认同版 hash", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-match-api-"));
  const clock = createClock({ now: () => new Date("2026-08-31T00:00:00.000Z") });
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
    id: "api-renter",
    ownerId: renter.userId,
    kind: "renter",
    label: "静安寺",
    payload: { mandate: structuredClone(baseMandate), inputVersion: 1 },
    inputVersion: 1,
    expiresAt: "2026-09-30T00:00:00.000Z"
  });
  app.repository.createTask({
    id: "api-supply",
    ownerId: supply.userId,
    kind: "supply",
    label: "个人房源",
    payload: { draft: structuredClone(demoSupplyDraft), inputVersion: 1 },
    inputVersion: 1,
    expiresAt: "2026-09-30T00:00:00.000Z"
  });
  app.matching.processTask("api-renter");
  const created = app.matching.matchCaseRepository.findByPair("api-renter", "api-supply");
  const route = `/api/matches/${created.id}`;

  const taskMatches = await request(baseUrl, "/api/tasks/api-renter/matches", { cookie: renter.cookie });
  assert.equal(taskMatches.response.status, 200);
  assert.equal(taskMatches.payload.matches.length, 1);
  assert.equal(taskMatches.payload.matches[0].myParty, "renter");
  assert.equal(taskMatches.payload.matches[0].myDecision, "pending");
  assert.equal(taskMatches.payload.matches[0].contactUnlocked, false);
  assert.match(taskMatches.payload.matches[0].currentTerms.hash, /^sha256:/u);
  assert.doesNotMatch(JSON.stringify(taskMatches.payload), /hardMax|minimumAuthorizedRent|rawText|contactValue/);
  assert.equal((await request(baseUrl, route, { cookie: stranger.cookie })).response.status, 404);
  assert.equal((await request(baseUrl, "/api/tasks/api-renter/matches", { cookie: stranger.cookie })).response.status, 404);

  const terms = taskMatches.payload.matches[0].currentTerms;
  const stale = await request(baseUrl, `${route}/confirm`, {
    cookie: renter.cookie,
    method: "POST",
    body: { termsVersion: terms.version, termsHash: "sha256:stale" }
  });
  assert.equal(stale.response.status, 409);

  const missingContact = await request(baseUrl, `${route}/confirm`, {
    cookie: renter.cookie,
    method: "POST",
    body: { termsVersion: terms.version, termsHash: terms.hash }
  });
  assert.equal(missingContact.response.status, 422);
  assert.equal(missingContact.payload.code, "CONTACT_REQUIRED");

  const renterContactValue = "renter_api_2026";
  const supplyContactValue = "+8613800138000";
  const renterContact = await request(baseUrl, "/api/profile/contact", {
    cookie: renter.cookie,
    method: "PUT",
    body: { type: "wechat", value: renterContactValue }
  });
  const supplyContact = await request(baseUrl, "/api/profile/contact", {
    cookie: supply.cookie,
    method: "PUT",
    body: { type: "phone", value: supplyContactValue }
  });
  assert.equal(renterContact.response.status, 200);
  assert.equal(supplyContact.response.status, 200);
  assert.equal(renterContact.payload.contact.value, undefined);
  assert.equal(supplyContact.payload.contact.maskedValue, "+86138****8000");
  assert.doesNotMatch(JSON.stringify({ renterContact: renterContact.payload, supplyContact: supplyContact.payload }), /renter_api_2026|13800138000/u);

  const renterConfirmed = await request(baseUrl, `${route}/confirm`, {
    cookie: renter.cookie,
    method: "POST",
    body: { termsVersion: terms.version, termsHash: terms.hash }
  });
  assert.equal(renterConfirmed.response.status, 200);
  assert.equal(renterConfirmed.payload.matchCase.status, "awaiting_confirmations");
  assert.equal(renterConfirmed.payload.matchCase.myDecision, "confirmed");
  assert.equal(renterConfirmed.payload.matchCase.otherDecision, "pending");
  assert.equal(renterConfirmed.payload.matchCase.contactUnlocked, false);
  const renterLocked = await request(baseUrl, `${route}/contact`, { cookie: renter.cookie });
  const supplyLocked = await request(baseUrl, `${route}/contact`, { cookie: supply.cookie });
  assert.equal(renterLocked.response.status, 403);
  assert.equal(supplyLocked.response.status, 403);
  assert.equal(renterLocked.payload.code, "CONTACT_LOCKED");

  const supplyView = await request(baseUrl, route, { cookie: supply.cookie });
  assert.equal(supplyView.payload.matchCase.myDecision, "pending");
  assert.equal(supplyView.payload.matchCase.otherDecision, "confirmed");
  const supplyConfirmed = await request(baseUrl, `${route}/confirm`, {
    cookie: supply.cookie,
    method: "POST",
    body: { termsVersion: terms.version, termsHash: terms.hash }
  });
  assert.equal(supplyConfirmed.payload.matchCase.status, "mutually_confirmed");
  assert.equal(supplyConfirmed.payload.matchCase.myDecision, "confirmed");
  assert.equal(supplyConfirmed.payload.matchCase.otherDecision, "confirmed");
  assert.equal(supplyConfirmed.payload.matchCase.contactUnlocked, true);

  const renterReveal = await request(baseUrl, `${route}/contact`, { cookie: renter.cookie });
  const supplyReveal = await request(baseUrl, `${route}/contact`, { cookie: supply.cookie });
  assert.deepEqual(renterReveal.payload.contact, { type: "phone", value: supplyContactValue });
  assert.deepEqual(supplyReveal.payload.contact, { type: "wechat", value: renterContactValue });
  assert.equal((await request(baseUrl, `${route}/contact`, { cookie: stranger.cookie })).response.status, 404);
  assert.equal(app.repository.raw.prepare("SELECT COUNT(*) AS count FROM contact_grants WHERE match_case_id = ?").get(created.id).count, 1);
  assert.doesNotMatch(JSON.stringify(app.matching.matchCaseRepository.listEvents(created.id)), /renter_api_2026|13800138000/u);

  const replay = await request(baseUrl, `${route}/confirm`, {
    cookie: supply.cookie,
    method: "POST",
    body: { termsVersion: terms.version, termsHash: terms.hash }
  });
  assert.equal(replay.payload.idempotent, true);
});
