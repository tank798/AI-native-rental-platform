import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import { createClock } from "../src/clock.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createMediaRepository } from "../src/server/media-repository.mjs";
import { createMediaService } from "../src/server/media-service.mjs";
import { demoSupplyDraft } from "../src/fixtures.mjs";

const now = new Date("2026-08-31T08:00:00.000Z");

async function setup(options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-media-"));
  const clock = createClock({ now: () => new Date(now) });
  const database = openRentalDatabase(path.join(tempDir, "rental.sqlite"), { clock });
  database.createProfile({ id: "media-owner", tokenHash: "media-owner-token" });
  database.createTask({
    id: "media-supply",
    ownerId: "media-owner",
    kind: "supply",
    label: "媒体测试房源",
    payload: { draft: structuredClone(demoSupplyDraft), inputVersion: 1 },
    expiresAt: "2026-10-01T00:00:00.000Z"
  });
  const mediaRepository = createMediaRepository({ database, clock });
  const media = createMediaService({
    mediaRepository,
    uploadRoot: path.join(tempDir, "uploads"),
    clock,
    ...options
  });
  return { tempDir, clock, database, mediaRepository, media };
}

async function close(context) {
  context.database.close();
  await fs.rm(context.tempDir, { recursive: true, force: true });
}

async function jpegWithGps() {
  return sharp({ create: { width: 320, height: 240, channels: 3, background: "#b8c9d6" } })
    .jpeg()
    .withExif({
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "31/1 13/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "121/1 28/1 0/1"
      }
    })
    .toBuffer();
}

test("公开照片真实解码、移除 EXIF/GPS、限制路径并按内容哈希幂等", async (t) => {
  const context = await setup();
  t.after(() => close(context));
  const original = await jpegWithGps();
  assert.ok((await sharp(original).metadata()).exif);

  const first = await context.media.uploadPublic({
    taskId: "media-supply",
    ownerId: "media-owner",
    mimeType: "image/jpeg",
    data: original,
    alt: "朝南卧室现场实拍",
    publicConsent: true,
    originalName: "../../private/escape.jpg"
  });
  assert.equal(first.duplicate, false);
  assert.match(first.media.src, /^\/api\/media\//u);
  assert.equal(first.media.alt, "朝南卧室现场实拍");

  const stored = context.mediaRepository.get(first.media.id);
  assert.ok(stored.originalPath.startsWith(path.join(context.tempDir, "uploads", "private-originals") + path.sep));
  assert.ok(stored.derivativePath.startsWith(path.join(context.tempDir, "uploads", "public-derivatives") + path.sep));
  assert.doesNotMatch(`${stored.originalPath}${stored.derivativePath}`, /escape|\.\./u);
  const derivativeMetadata = await sharp(stored.derivativePath).metadata();
  assert.equal(derivativeMetadata.format, "webp");
  assert.equal(derivativeMetadata.exif, undefined);
  assert.equal(derivativeMetadata.xmp, undefined);
  assert.equal(derivativeMetadata.iptc, undefined);
  assert.equal(derivativeMetadata.icc, undefined);
  assert.equal(derivativeMetadata.comments, undefined);
  assert.equal(derivativeMetadata.orientation, undefined);

  const repeated = await context.media.uploadPublic({
    taskId: "media-supply",
    ownerId: "media-owner",
    mimeType: "image/jpeg",
    data: original,
    alt: "重复提交",
    publicConsent: true
  });
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.media.id, first.media.id);
  assert.equal((await fs.readdir(path.join(context.tempDir, "uploads", "private-originals"))).length, 1);
  assert.equal((await fs.readdir(path.join(context.tempDir, "uploads", "public-derivatives"))).length, 1);

  assert.equal(context.media.deleteForTask("media-supply", "media-owner"), 1);
  assert.throws(() => context.media.getReadable(first.media.id, "media-owner"), (error) => error.code === "MEDIA_NOT_FOUND");
  const cleanup = context.mediaRepository.cleanupForMedia(first.media.id);
  assert.ok(cleanup);
  assert.equal(cleanup.cleaned_at, null);
  assert.equal(await context.media.cleanupPending(), 1);
  await assert.rejects(fs.stat(stored.originalPath), /ENOENT/u);
  await assert.rejects(fs.stat(stored.derivativePath), /ENOENT/u);
});

test("文本伪图片、MIME 伪装、动画、超大像素和缺少公开授权都会被拒绝", async (t) => {
  const context = await setup({ maxBytes: 64 * 1024, maxPixels: 10_000 });
  t.after(() => close(context));
  const validJpeg = await sharp({ create: { width: 80, height: 80, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
  const validPng = await sharp({ create: { width: 80, height: 80, channels: 4, background: "#ffffff" } }).png().toBuffer();
  const largePng = await sharp({ create: { width: 101, height: 101, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const animatedRaw = Buffer.from([255, 0, 0, 0, 0, 255]);
  const animatedWebp = await sharp(animatedRaw, { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  assert.equal((await sharp(animatedWebp, { animated: true }).metadata()).pages, 2);

  const base = {
    taskId: "media-supply",
    ownerId: "media-owner",
    alt: "测试图片",
    publicConsent: true
  };
  await assert.rejects(
    context.media.uploadPublic({ ...base, mimeType: "image/jpeg", data: validJpeg, publicConsent: false }),
    (error) => error.code === "PUBLIC_MEDIA_CONSENT_REQUIRED"
  );
  await assert.rejects(
    context.media.uploadPublic({
      ...base,
      mimeType: "image/jpeg",
      data: `data:image/jpeg;base64,${Buffer.from('<svg onload="alert(1)">not a jpeg</svg>').toString("base64")}`
    }),
    (error) => error.code === "MEDIA_DECODE_FAILED"
  );
  await assert.rejects(
    context.media.uploadPublic({ ...base, mimeType: "image/jpeg", data: validPng }),
    (error) => error.code === "MEDIA_TYPE_MISMATCH"
  );
  await assert.rejects(
    context.media.uploadPublic({ ...base, mimeType: "image/webp", data: animatedWebp }),
    (error) => error.code === "MEDIA_ANIMATION_REJECTED"
  );
  await assert.rejects(
    context.media.uploadPublic({ ...base, mimeType: "image/png", data: largePng }),
    (error) => ["MEDIA_DECODE_FAILED", "MEDIA_PIXEL_LIMIT"].includes(error.code)
  );
  await assert.rejects(
    context.media.uploadPublic({ ...base, mimeType: "image/jpeg", data: "not-base64" }),
    (error) => error.code === "MEDIA_BASE64_INVALID"
  );
  await assert.rejects(
    context.media.uploadPublic({ ...base, mimeType: "image/jpeg", data: Buffer.alloc(64 * 1024 + 1) }),
    (error) => error.code === "MEDIA_TOO_LARGE"
  );
});
