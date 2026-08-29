import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRentalServer } from "../server.mjs";
import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";

async function request(baseUrl, route, { token, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload };
}

async function session(baseUrl) {
  const { response, payload } = await request(baseUrl, "/api/session", { method: "POST", body: {} });
  assert.equal(response.status, 201);
  return payload;
}

test("服务端持久化双边任务并在新供给到达后增量更新双方候选", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-api-"));
  const databasePath = path.join(tempDir, "rental.sqlite");
  const uploadRoot = path.join(tempDir, "uploads");
  const app = createRentalServer({ databasePath, uploadRoot, enableScheduler: false });
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

  const mandate = structuredClone(baseMandate);
  mandate.locations = ["临港新城"];
  mandate.budget = { target: 3000, hardMax: 3400, targetIsPrivate: true, hardMaxIsPrivate: true };
  mandate.moveInWindow = { from: "2026-09-01", to: "2026-09-08" };
  mandate.maxCommuteMinutes = 40;
  const renterCreated = await request(baseUrl, "/api/tasks", {
    token: renterSession.token,
    method: "POST",
    body: { kind: "renter", payload: { mandate, rawText: "临港新城找房" } }
  });
  assert.equal(renterCreated.response.status, 201);
  assert.equal(renterCreated.payload.candidates.length, 0);

  const evidenceRefs = {};
  for (const kind of ["identity", "roleDocument", "rightsDocument", "livePhotoChallenge"]) {
    const uploaded = await request(baseUrl, "/api/evidence", {
      token: supplySession.token,
      method: "POST",
      body: {
        kind,
        name: `${kind}.jpg`,
        mimeType: "image/jpeg",
        data: Buffer.from(`private-${kind}`).toString("base64")
      }
    });
    assert.equal(uploaded.response.status, 201);
    evidenceRefs[kind] = uploaded.payload.id;
  }

  const draft = structuredClone(demoSupplyDraft);
  draft.location = "临港新城";
  draft.station = "滴水湖站";
  draft.district = "浦东新区";
  draft.address = "浦东新区海港大道 999 号";
  draft.title = "临港新城个人直租";
  draft.availableFrom = "2026-09-03";
  const supplyCreated = await request(baseUrl, "/api/tasks", {
    token: supplySession.token,
    method: "POST",
    body: { kind: "supply", payload: { draft, evidenceRefs, rawText: "临港新城房源" } }
  });
  assert.equal(supplyCreated.response.status, 201);
  assert.equal(supplyCreated.payload.candidates.length, 1);
  assert.match(supplyCreated.payload.candidates[0].displayAlias, /^租客 /);
  assert.equal(supplyCreated.payload.candidates[0].tenant.mandate.budget, undefined);

  const renterUpdated = await request(baseUrl, `/api/tasks/${renterCreated.payload.task.id}`, { token: renterSession.token });
  assert.equal(renterUpdated.response.status, 200);
  assert.equal(renterUpdated.payload.candidates.length, 1);
  assert.equal(renterUpdated.payload.candidates[0].listing.minRent, undefined);
  assert.doesNotMatch(renterUpdated.payload.candidates[0].listing.addressHint, /海港大道/);
  assert.ok(renterUpdated.payload.task.runCount >= 2);

  const denied = await request(baseUrl, `/api/tasks/${renterCreated.payload.task.id}`, { token: supplySession.token });
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
  const result = await request(baseUrl, "/api/tasks", {
    token: owner.token,
    method: "POST",
    body: { kind: "supply", payload: { draft: demoSupplyDraft, evidenceRefs: {} } }
  });
  assert.equal(result.response.status, 422);
  assert.match(result.payload.error, /身份核验未完成/);
});
