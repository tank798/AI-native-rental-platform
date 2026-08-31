import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import { createRentalServer } from "../server.mjs";
import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";
import { testContactEncryptionKey } from "./test-secrets.mjs";

async function jsonRequest(baseUrl, route, { cookie, method = "GET", body } = {}) {
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

async function createSession(baseUrl) {
  const { response, payload } = await jsonRequest(baseUrl, "/api/session", { method: "POST", body: {} });
  assert.equal(response.status, 201);
  return { ...payload, cookie: String(response.headers.get("set-cookie")).split(";", 1)[0] };
}

test("公开媒体 API 只返回净化 derivative，候选可读、第三方与私密材料不可读，删任务后进入清理队列", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-media-api-"));
  const app = createRentalServer({
    databasePath: path.join(tempDir, "rental.sqlite"),
    uploadRoot: path.join(tempDir, "uploads"),
    enableScheduler: false,
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

  const renter = await createSession(baseUrl);
  const supply = await createSession(baseUrl);
  const stranger = await createSession(baseUrl);
  const mandate = structuredClone(baseMandate);
  const draft = structuredClone(demoSupplyDraft);
  app.repository.createTask({
    id: "media-renter-task",
    ownerId: renter.userId,
    kind: "renter",
    label: "静安寺",
    payload: { mandate, rawText: "静安寺找房", inputVersion: 1, fieldStates: {} },
    expiresAt: "2026-10-01T00:00:00.000Z"
  });
  app.repository.createTask({
    id: "media-supply-task",
    ownerId: supply.userId,
    kind: "supply",
    label: "静安寺个人房源",
    payload: { draft, rawText: "静安寺个人房源", inputVersion: 1, fieldStates: {} },
    expiresAt: "2026-10-01T00:00:00.000Z"
  });
  app.worker.drain();
  assert.equal(app.matching.snapshot("media-renter-task").candidates.length, 1);

  const malicious = await jsonRequest(baseUrl, "/api/tasks/media-supply-task/media", {
    cookie: supply.cookie,
    method: "POST",
    body: {
      name: "../../escape.jpg",
      mimeType: "image/jpeg",
      data: `data:image/jpeg;base64,${Buffer.from("<svg><script>alert(1)</script></svg>").toString("base64")}`,
      alt: "恶意伪图片",
      publicConsent: true
    }
  });
  assert.equal(malicious.response.status, 422);
  assert.equal(malicious.payload.code, "MEDIA_DECODE_FAILED");

  const oversizedResponse = await fetch(`${baseUrl}/api/tasks/media-supply-task/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: supply.cookie },
    body: JSON.stringify({
      mimeType: "image/jpeg",
      data: "A".repeat(12 * 1024 * 1024),
      alt: "超大请求",
      publicConsent: true
    })
  });
  assert.equal(oversizedResponse.status, 413);
  assert.equal((await oversizedResponse.json()).code, "REQUEST_TOO_LARGE");

  const jpeg = await sharp({ create: { width: 240, height: 180, channels: 3, background: "#b6c8d5" } })
    .jpeg()
    .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "31/1 13/1 0/1" } })
    .toBuffer();
  const uploaded = await jsonRequest(baseUrl, "/api/tasks/media-supply-task/media", {
    cookie: supply.cookie,
    method: "POST",
    body: {
      name: "../../ignored.jpg",
      mimeType: "image/jpeg",
      data: jpeg.toString("base64"),
      alt: "卧室窗边现场实拍",
      publicConsent: true
    }
  });
  assert.equal(uploaded.response.status, 201);
  assert.equal(uploaded.payload.duplicate, false);
  assert.equal(app.repository.getTask("media-supply-task").inputVersion, 2);
  assert.deepEqual(Object.keys(uploaded.payload.media).sort(), ["alt", "height", "id", "src", "width"]);
  assert.doesNotMatch(JSON.stringify(uploaded.payload), /original|derivative|private-originals|public-derivatives/iu);

  const duplicate = await jsonRequest(baseUrl, "/api/tasks/media-supply-task/media", {
    cookie: supply.cookie,
    method: "POST",
    body: { mimeType: "image/jpeg", data: jpeg.toString("base64"), alt: "重复图片", publicConsent: true }
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.payload.media.id, uploaded.payload.media.id);
  assert.equal(app.repository.getTask("media-supply-task").inputVersion, 2);

  const renterSnapshot = await jsonRequest(baseUrl, "/api/tasks/media-renter-task", { cookie: renter.cookie });
  assert.equal(renterSnapshot.response.status, 200);
  assert.deepEqual(renterSnapshot.payload.candidates[0].listing.photos, [uploaded.payload.media]);
  assert.doesNotMatch(JSON.stringify(renterSnapshot.payload), /evidenceRefs|private-originals|GPSLatitude/iu);

  const ownerImage = await fetch(`${baseUrl}${uploaded.payload.media.src}`, { headers: { Cookie: supply.cookie } });
  assert.equal(ownerImage.status, 200);
  assert.equal(ownerImage.headers.get("content-type"), "image/webp");
  assert.match(ownerImage.headers.get("cache-control") || "", /^private/u);
  const derivative = Buffer.from(await ownerImage.arrayBuffer());
  const derivativeMetadata = await sharp(derivative).metadata();
  assert.equal(derivativeMetadata.exif, undefined);
  assert.equal(derivativeMetadata.orientation, undefined);

  const candidateImage = await fetch(`${baseUrl}${uploaded.payload.media.src}`, { headers: { Cookie: renter.cookie } });
  assert.equal(candidateImage.status, 200);
  const noSession = await fetch(`${baseUrl}${uploaded.payload.media.src}`);
  assert.equal(noSession.status, 401);
  const outsider = await fetch(`${baseUrl}${uploaded.payload.media.src}`, { headers: { Cookie: stranger.cookie } });
  assert.equal(outsider.status, 404);

  const privatePath = path.join(tempDir, "private-evidence.jpg");
  await fs.writeFile(privatePath, jpeg);
  app.repository.addEvidence({
    id: "private-evidence-media-id",
    ownerId: supply.userId,
    kind: "livePhotoChallenge",
    storagePath: privatePath,
    originalName: "private.jpg",
    mimeType: "image/jpeg",
    sha256: "private"
  });
  const privateRead = await fetch(`${baseUrl}/api/media/private-evidence-media-id`, { headers: { Cookie: supply.cookie } });
  assert.equal(privateRead.status, 404);

  const deleted = await jsonRequest(baseUrl, "/api/tasks/media-supply-task", { cookie: supply.cookie, method: "DELETE" });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.payload.queuedMedia, 1);
  const afterDelete = await fetch(`${baseUrl}${uploaded.payload.media.src}`, { headers: { Cookie: renter.cookie } });
  assert.equal(afterDelete.status, 404);
  assert.ok(app.mediaRepository.cleanupForMedia(uploaded.payload.media.id));
  const renterAfterDelete = await jsonRequest(baseUrl, "/api/tasks/media-renter-task", { cookie: renter.cookie });
  assert.equal(renterAfterDelete.payload.candidates.length, 0);
});
