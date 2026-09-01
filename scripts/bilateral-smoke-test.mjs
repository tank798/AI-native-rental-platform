import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import { createRentalServer } from "../server.mjs";
import { createClock } from "../src/clock.mjs";
import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";

const FIXED_NOW = "2026-08-31T04:00:00.000Z";
const PRIVATE_FIELD_PATTERN = /hardMax|minimumAuthorizedRent|rawText|evidenceRefs|storagePath|contactValue|sessionSecret|cookie|apiKey/giu;

function encryptionKey() {
  return crypto.createHash("sha256").update("zhunaer-bilateral-smoke-contact-key").digest("base64");
}

async function request(baseUrl, route, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      // 写操作必须携带可校验的同源来源（参见 assertSameOrigin），
      // 真实浏览器对非 GET 请求必定发送 Origin，这里如实模拟。
      Origin: baseUrl,
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload };
}

async function createSession(baseUrl) {
  const result = await request(baseUrl, "/api/session", { method: "POST", body: {} });
  assert.equal(result.response.status, 201);
  return {
    ...result.payload,
    cookie: String(result.response.headers.get("set-cookie") || "").split(";", 1)[0]
  };
}

function expectStatus(result, status, label) {
  assert.equal(
    result.response.status,
    status,
    `${label}: HTTP ${result.response.status} ${JSON.stringify(result.payload)}`
  );
  return result.payload;
}

function publicLeakCount(payloads, secrets) {
  const serialized = payloads.map((payload) => JSON.stringify(payload)).join("\n");
  const fieldMatches = serialized.match(PRIVATE_FIELD_PATTERN) || [];
  const secretMatches = secrets.flatMap((secret) => secret && serialized.includes(secret) ? [secret] : []);
  return fieldMatches.length + secretMatches.length;
}

async function uploadAndReviewEvidence({ app, baseUrl, owner }) {
  const refs = {};
  for (const kind of ["identity", "roleDocument", "rightsDocument", "livePhotoChallenge"]) {
    const uploaded = await request(baseUrl, "/api/evidence", {
      cookie: owner.cookie,
      method: "POST",
      body: {
        kind,
        name: `${kind}.jpg`,
        mimeType: "image/jpeg",
        data: Buffer.from(`private-smoke-${kind}`).toString("base64")
      }
    });
    expectStatus(uploaded, 201, `上传 ${kind}`);
    refs[kind] = uploaded.payload.id;
    const reviewed = app.verification.reviewEvidence({
      evidenceId: uploaded.payload.id,
      reviewer: "bilateral-smoke-reviewer",
      method: "manual_review",
      result: "approved"
    });
    assert.equal(reviewed.verificationStatus, "verified");
  }
  return refs;
}

async function answerVisibleClarifications({ baseUrl, owner, matchCaseId, value = true }) {
  let view = await request(baseUrl, `/api/matches/${encodeURIComponent(matchCaseId)}`, { cookie: owner.cookie });
  expectStatus(view, 200, "读取待澄清案例");
  for (const question of view.payload.matchCase.clarifications.questions) {
    const expectedType = question.answerSpec?.expectedAnswerType;
    const answer = expectedType === "boolean"
      ? Boolean(value)
      : expectedType === "number"
        ? 3200
        : question.answerSpec?.options?.[0] ?? String(value);
    view = await request(
      baseUrl,
      `/api/matches/${encodeURIComponent(matchCaseId)}/clarifications/${encodeURIComponent(question.id)}/answers`,
      { cookie: owner.cookie, method: "POST", body: { answer } }
    );
    expectStatus(view, 200, "回答澄清问题");
  }
  return view.payload.matchCase;
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-bilateral-smoke-"));
  const clock = createClock({ now: () => new Date(FIXED_NOW) });
  const app = createRentalServer({
    databasePath: path.join(tempDir, "rental.sqlite"),
    uploadRoot: path.join(tempDir, "uploads"),
    enableScheduler: false,
    marketMode: "real",
    aiApiKey: null,
    aiKeyFile: null,
    environment: {},
    clock,
    contactEncryptionKey: encryptionKey()
  });
  const publicPayloads = [];
  const secrets = ["renter_smoke_private", "supply.smoke.private@example.com"];

  try {
    const address = await app.listen(0);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const renter = await createSession(baseUrl);
    const supply = await createSession(baseUrl);
    const outsider = await createSession(baseUrl);

    expectStatus(await request(baseUrl, "/api/profile/contact", {
      cookie: renter.cookie,
      method: "PUT",
      body: { type: "wechat", value: secrets[0] }
    }), 200, "设置租客联系人");
    expectStatus(await request(baseUrl, "/api/profile/contact", {
      cookie: supply.cookie,
      method: "PUT",
      body: { type: "email", value: secrets[1] }
    }), 200, "设置房东联系人");

    const mandate = structuredClone(baseMandate);
    mandate.id = randomUUID();
    const renterCreated = await request(baseUrl, "/api/tasks", {
      cookie: renter.cookie,
      method: "POST",
      body: {
        clientRequestId: "bilateral-smoke-renter-v1",
        kind: "renter",
        payload: {
          mandate,
          rawText: "静安寺附近，预算 3000 到 3100，女生合租，9 月初入住，租 12 个月",
          inputVersion: 1,
          fieldStates: {}
        }
      }
    });
    expectStatus(renterCreated, 201, "创建租客任务");
    publicPayloads.push(renterCreated.payload);
    assert.equal(renterCreated.payload.candidates.length, 0);
    const seedCandidateCount = renterCreated.payload.candidates.filter((item) => item.source === "fixture").length;

    const evidenceRefs = await uploadAndReviewEvidence({ app, baseUrl, owner: supply });
    const draft = structuredClone(demoSupplyDraft);
    draft.facilities.kitchen = null;
    const supplyCreated = await request(baseUrl, "/api/tasks", {
      cookie: supply.cookie,
      method: "POST",
      body: {
        clientRequestId: "bilateral-smoke-supply-v1",
        kind: "supply",
        payload: {
          draft,
          evidenceRefs,
          rawText: "现租客本人个人转租，静安寺朝南次卧，月租 3200 元，9 月 3 日入住，无中介费无服务费",
          inputVersion: 1,
          fieldStates: {}
        }
      }
    });
    expectStatus(supplyCreated, 201, "创建房源任务");
    publicPayloads.push(supplyCreated.payload);
    assert.equal(supplyCreated.payload.candidates.length, 1);
    const supplyTaskId = supplyCreated.payload.task.id;
    const matchCaseId = supplyCreated.payload.candidates[0].matchCaseId;
    assert.ok(matchCaseId);

    const jpeg = await sharp({
      create: { width: 480, height: 320, channels: 3, background: "#b7c8b4" }
    }).jpeg({ quality: 85 }).toBuffer();
    const photo = await request(baseUrl, `/api/tasks/${encodeURIComponent(supplyTaskId)}/media`, {
      cookie: supply.cookie,
      method: "POST",
      body: {
        mimeType: "image/jpeg",
        data: jpeg.toString("base64"),
        alt: "双边冒烟测试公开实拍",
        publicConsent: true
      }
    });
    expectStatus(photo, 201, "上传公开实拍");
    publicPayloads.push(photo.payload);

    const renterAfterSupply = await request(
      baseUrl,
      `/api/tasks/${encodeURIComponent(renterCreated.payload.task.id)}`,
      { cookie: renter.cookie }
    );
    expectStatus(renterAfterSupply, 200, "租客读取真实候选");
    publicPayloads.push(renterAfterSupply.payload);
    assert.equal(renterAfterSupply.payload.candidates[0].matchCaseId, matchCaseId);

    let renterCase = await answerVisibleClarifications({ baseUrl, owner: renter, matchCaseId });
    let supplyCase = await answerVisibleClarifications({ baseUrl, owner: supply, matchCaseId });
    renterCase = expectStatus(
      await request(baseUrl, `/api/matches/${encodeURIComponent(matchCaseId)}`, { cookie: renter.cookie }),
      200,
      "租客读取条款"
    ).matchCase;
    supplyCase = expectStatus(
      await request(baseUrl, `/api/matches/${encodeURIComponent(matchCaseId)}`, { cookie: supply.cookie }),
      200,
      "房东读取条款"
    ).matchCase;
    publicPayloads.push({ renterCase, supplyCase });
    assert.equal(renterCase.status, "terms_ready");
    assert.equal(supplyCase.status, "terms_ready");
    assert.equal(renterCase.currentTerms.version, supplyCase.currentTerms.version);
    assert.equal(renterCase.currentTerms.hash, supplyCase.currentTerms.hash);
    const originalTerms = renterCase.currentTerms;

    expectStatus(await request(baseUrl, `/api/matches/${encodeURIComponent(matchCaseId)}/confirm`, {
      cookie: renter.cookie,
      method: "POST",
      body: { termsVersion: originalTerms.version, termsHash: originalTerms.hash }
    }), 200, "租客确认条款");
    const renterLocked = await request(baseUrl, `/api/matches/${encodeURIComponent(matchCaseId)}/contact`, {
      cookie: renter.cookie
    });
    assert.equal(renterLocked.response.status, 403);
    assert.equal(renterLocked.payload.code, "CONTACT_LOCKED");

    expectStatus(await request(baseUrl, `/api/matches/${encodeURIComponent(matchCaseId)}/confirm`, {
      cookie: supply.cookie,
      method: "POST",
      body: { termsVersion: originalTerms.version, termsHash: originalTerms.hash }
    }), 200, "房东确认条款");
    const renterReveal = expectStatus(
      await request(baseUrl, `/api/matches/${encodeURIComponent(matchCaseId)}/contact`, { cookie: renter.cookie }),
      200,
      "租客读取房东联系人"
    );
    const supplyReveal = expectStatus(
      await request(baseUrl, `/api/matches/${encodeURIComponent(matchCaseId)}/contact`, { cookie: supply.cookie }),
      200,
      "房东读取租客联系人"
    );
    assert.equal(renterReveal.contact.value, secrets[1]);
    assert.equal(supplyReveal.contact.value, secrets[0]);

    const outsiderCase = await request(baseUrl, `/api/matches/${encodeURIComponent(matchCaseId)}`, {
      cookie: outsider.cookie
    });
    const outsiderContact = await request(baseUrl, `/api/matches/${encodeURIComponent(matchCaseId)}/contact`, {
      cookie: outsider.cookie
    });
    assert.equal(outsiderCase.response.status, 404);
    assert.equal(outsiderContact.response.status, 404);

    expectStatus(await request(baseUrl, `/api/tasks/${encodeURIComponent(supplyTaskId)}`, {
      cookie: supply.cookie,
      method: "PATCH",
      body: { status: "paused" }
    }), 200, "暂停房源任务");
    const afterPauseContact = await request(baseUrl, `/api/matches/${encodeURIComponent(matchCaseId)}/contact`, {
      cookie: renter.cookie
    });
    assert.equal(afterPauseContact.response.status, 403);
    assert.equal(afterPauseContact.payload.code, "CONTACT_LOCKED");
    expectStatus(await request(baseUrl, `/api/tasks/${encodeURIComponent(supplyTaskId)}`, {
      cookie: supply.cookie,
      method: "PATCH",
      body: { status: "active" }
    }), 200, "恢复房源任务");

    const refreshed = expectStatus(
      await request(baseUrl, `/api/matches/${encodeURIComponent(matchCaseId)}`, { cookie: renter.cookie }),
      200,
      "读取重算案例"
    ).matchCase;
    publicPayloads.push(refreshed);
    assert.equal(refreshed.myDecision, "pending");
    assert.equal(refreshed.contactUnlocked, false);
    assert.equal(refreshed.requiresReconfirmation, true);

    const summary = {
      caseCreated: Boolean(matchCaseId),
      clarificationResolved: renterCase.clarifications.questions.length === 0
        && supplyCase.clarifications.questions.length === 0,
      sameTermsVersion: renterCase.currentTerms.version === supplyCase.currentTerms.version
        && renterCase.currentTerms.hash === supplyCase.currentTerms.hash,
      singlePartyContactLocked: renterLocked.response.status === 403,
      mutualContactUnlocked: renterReveal.contact.value === secrets[1] && supplyReveal.contact.value === secrets[0],
      outsiderDenied: outsiderCase.response.status === 404 && outsiderContact.response.status === 404,
      changedTermsRevokedGrant: afterPauseContact.response.status === 403
        && refreshed.myDecision === "pending"
        && refreshed.contactUnlocked === false,
      privateLeakCount: publicLeakCount(publicPayloads, secrets),
      seedCandidateCount
    };
    assert.deepEqual(summary, {
      caseCreated: true,
      clarificationResolved: true,
      sameTermsVersion: true,
      singlePartyContactLocked: true,
      mutualContactUnlocked: true,
      outsiderDenied: true,
      changedTermsRevokedGrant: true,
      privateLeakCount: 0,
      seedCandidateCount: 0
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(`bilateral smoke failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
