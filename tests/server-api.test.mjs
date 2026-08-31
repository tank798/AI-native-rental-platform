import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRentalServer } from "../server.mjs";
import { createClock } from "../src/clock.mjs";
import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";

async function request(baseUrl, route, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload };
}

async function session(baseUrl) {
  const { response, payload } = await request(baseUrl, "/api/session", { method: "POST", body: {} });
  assert.equal(response.status, 201);
  assert.equal(payload.token, undefined);
  assert.match(response.headers.get("set-cookie") || "", /HttpOnly/);
  return {
    ...payload,
    cookie: String(response.headers.get("set-cookie") || "").split(";", 1)[0]
  };
}

test("服务端持久化双边任务并在新供给到达后增量更新双方候选", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-api-"));
  const databasePath = path.join(tempDir, "rental.sqlite");
  const uploadRoot = path.join(tempDir, "uploads");
  const clock = createClock({ now: () => new Date("2026-08-29T16:00:00.000Z") });
  const app = createRentalServer({ databasePath, uploadRoot, enableScheduler: false, clock });
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

  const renterSession = await session(baseUrl);
  const supplySession = await session(baseUrl);
  const health = await request(baseUrl, "/api/health");
  assert.equal(health.payload.database, "sqlite");
  assert.equal(health.payload.continuousMatching, true);
  assert.equal(health.payload.marketMode, "real");
  assert.equal(health.payload.demoBanner, false);

  const mandate = structuredClone(baseMandate);
  mandate.locations = ["临港新城"];
  mandate.budget = { target: 3000, hardMax: 3400, targetIsPrivate: true, hardMaxIsPrivate: true };
  mandate.moveInWindow = { from: "2026-09-01", to: "2026-09-08" };
  mandate.maxCommuteMinutes = 25;
  mandate.leaseMonths = 6;
  mandate.sharedHousing = false;
  mandate.roommateGender = null;
  mandate.hardConstraints.kitchen = false;
  const renterCreated = await request(baseUrl, "/api/tasks", {
    cookie: renterSession.cookie,
    method: "POST",
    body: {
      kind: "renter",
      payload: {
        mandate,
        rawText: "临港新城找房",
        inputVersion: 7,
        fieldStates: { commute: { value: 25, source: "user", confirmationStatus: "user_confirmed", version: 2 } }
      }
    }
  });
  assert.equal(renterCreated.response.status, 201);
  assert.equal(renterCreated.payload.candidates.length, 0);
  assert.equal(renterCreated.payload.task.expiresAt, "2026-09-28T16:00:00.000Z");
  const persistedMandate = app.repository.getTask(renterCreated.payload.task.id).payload.mandate;
  assert.equal(persistedMandate.maxCommuteMinutes, 25);
  assert.equal(persistedMandate.leaseMonths, 6);
  assert.equal(persistedMandate.sharedHousing, false);
  assert.equal(persistedMandate.hardConstraints.kitchen, false);
  assert.equal(app.repository.getTask(renterCreated.payload.task.id).payload.inputVersion, 7);
  assert.equal(app.repository.getTask(renterCreated.payload.task.id).payload.fieldStates.commute.value, 25);

  const evidenceRefs = {};
  for (const kind of ["identity", "roleDocument", "rightsDocument", "livePhotoChallenge"]) {
    const uploaded = await request(baseUrl, "/api/evidence", {
      cookie: supplySession.cookie,
      method: "POST",
      body: {
        kind,
        name: `${kind}.jpg`,
        mimeType: "image/jpeg",
        data: Buffer.from(`private-${kind}`).toString("base64")
      }
    });
    assert.equal(uploaded.response.status, 201);
    assert.equal(uploaded.payload.submissionStatus, "submitted");
    assert.equal(uploaded.payload.verificationStatus, "not_reviewed");
    assert.equal(uploaded.payload.displayLabel, "已上传，待审核");
    evidenceRefs[kind] = uploaded.payload.id;
  }

  const draft = structuredClone(demoSupplyDraft);
  draft.location = "临港新城";
  draft.station = "滴水湖站";
  draft.district = "浦东新区";
  draft.address = "浦东新区海港大道 999 号";
  draft.title = "临港新城个人直租";
  draft.availableFrom = "2026-09-03";
  draft.leaseMonthsMin = 6;
  draft.roommateCount = 0;
  draft.roommateGender = null;
  const pendingSupply = await request(baseUrl, "/api/tasks", {
    cookie: supplySession.cookie,
    method: "POST",
    body: { kind: "supply", payload: { draft, evidenceRefs, rawText: "临港新城房源" } }
  });
  assert.equal(pendingSupply.response.status, 422);
  assert.match(pendingSupply.payload.error, /已上传，待审核/);

  for (const evidenceId of Object.values(evidenceRefs)) {
    const reviewed = app.verification.reviewEvidence({
      evidenceId,
      reviewer: "integration-test-reviewer",
      method: "manual_review",
      result: "approved"
    });
    assert.equal(reviewed.verificationStatus, "verified");
    const publicStatus = await request(baseUrl, `/api/evidence/${encodeURIComponent(evidenceId)}`, { cookie: supplySession.cookie });
    assert.equal(publicStatus.response.status, 200);
    assert.equal(publicStatus.payload.source, "manual_review");
  }
  const hiddenFromOtherOwner = await request(
    baseUrl,
    `/api/evidence/${encodeURIComponent(evidenceRefs.identity)}`,
    { cookie: renterSession.cookie }
  );
  assert.equal(hiddenFromOtherOwner.response.status, 404);

  const supplyCreated = await request(baseUrl, "/api/tasks", {
    cookie: supplySession.cookie,
    method: "POST",
    body: { kind: "supply", payload: { draft, evidenceRefs, rawText: "临港新城房源" } }
  });
  assert.equal(supplyCreated.response.status, 201);
  assert.equal(supplyCreated.payload.candidates.length, 1);
  assert.match(supplyCreated.payload.candidates[0].displayAlias, /^租客 /);
  assert.equal(supplyCreated.payload.candidates[0].tenant.mandate.budget, undefined);
  assert.equal(supplyCreated.payload.candidates[0].tenant.mandate.maxCommuteMinutes, 25);
  assert.equal(supplyCreated.payload.candidates[0].tenant.mandate.leaseMonths, 6);
  assert.equal(supplyCreated.payload.candidates[0].tenant.mandate.sharedHousing, false);

  const renterUpdated = await request(baseUrl, `/api/tasks/${renterCreated.payload.task.id}`, { cookie: renterSession.cookie });
  assert.equal(renterUpdated.response.status, 200);
  assert.equal(renterUpdated.payload.candidates.length, 1);
  assert.equal(renterUpdated.payload.candidates[0].listing.minRent, undefined);
  assert.doesNotMatch(renterUpdated.payload.candidates[0].listing.addressHint, /海港大道/);
  assert.ok(renterUpdated.payload.task.runCount >= 2);

  const denied = await request(baseUrl, `/api/tasks/${renterCreated.payload.task.id}`, { cookie: supplySession.cookie });
  assert.equal(denied.response.status, 404);
});

test("出租任务必须使用当前会话真实上传的四类材料", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-evidence-"));
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
    if (error.code === "EPERM") return t.skip("当前沙箱禁止监听本机端口；在可监听环境运行 HTTP 集成测试");
    throw error;
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const owner = await session(baseUrl);
  const malicious = await request(baseUrl, "/api/tasks", {
    cookie: owner.cookie,
    method: "POST",
    body: {
      kind: "supply",
      payload: {
        draft: { ...demoSupplyDraft, role: "landlord", fees: { ...demoSupplyDraft.fees, service: 0, intermediary: 0 } },
        evidenceRefs: {},
        rawText: "中介代发，签约时收服务费 500 元"
      }
    }
  });
  assert.equal(malicious.response.status, 422);
  assert.equal(malicious.payload.code, "SUPPLY_RISK_REJECTED");

  const result = await request(baseUrl, "/api/tasks", {
    cookie: owner.cookie,
    method: "POST",
    body: { kind: "supply", payload: { draft: demoSupplyDraft, evidenceRefs: {} } }
  });
  assert.equal(result.response.status, 422);
  assert.match(result.payload.error, /身份材料未上传/);

  const revoked = await request(baseUrl, "/api/session", { cookie: owner.cookie, method: "DELETE" });
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.payload.revoked, true);
  assert.match(revoked.response.headers.get("set-cookie") || "", /Max-Age=0/);
  const afterRevocation = await request(baseUrl, "/api/tasks", { cookie: owner.cookie });
  assert.equal(afterRevocation.response.status, 401);
  assert.equal(afterRevocation.payload.code, "SESSION_INVALID");
});
