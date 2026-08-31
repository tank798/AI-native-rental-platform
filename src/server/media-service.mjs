import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { createClock } from "../clock.mjs";
import { publicMedia } from "./media-repository.mjs";

const MIME_BY_FORMAT = new Map([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"]
]);
const EXTENSION_BY_MIME = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"]
]);

function mediaError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedAlt(value) {
  const alt = String(value || "房源公开实拍").normalize("NFKC").replace(/[\u0000-\u001F\u007F]/gu, " ").trim();
  if (!alt) return "房源公开实拍";
  if (alt.length > 160) throw mediaError(422, "MEDIA_ALT_INVALID", "图片说明不能超过 160 个字符");
  return alt;
}

function strictBase64(value, maxBytes) {
  const encoded = String(value || "");
  if (!encoded || encoded.length > Math.ceil(maxBytes / 3) * 4 + 8) {
    throw mediaError(413, "MEDIA_TOO_LARGE", "房源照片超过大小限制");
  }
  if (encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    throw mediaError(422, "MEDIA_BASE64_INVALID", "图片数据不是标准 base64");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > maxBytes || buffer.toString("base64") !== encoded) {
    throw mediaError(buffer.length > maxBytes ? 413 : 422, buffer.length > maxBytes ? "MEDIA_TOO_LARGE" : "MEDIA_BASE64_INVALID", "图片数据无效");
  }
  return buffer;
}

function decodeInput(data, declaredMime, maxBytes) {
  if (Buffer.isBuffer(data)) {
    if (!data.length) throw mediaError(422, "MEDIA_DECODE_FAILED", "图片数据为空");
    if (data.length > maxBytes) throw mediaError(413, "MEDIA_TOO_LARGE", "房源照片超过大小限制");
    return { buffer: data, dataUrlMime: null };
  }
  const text = String(data || "");
  if (!text.startsWith("data:")) return { buffer: strictBase64(text, maxBytes), dataUrlMime: null };
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(text);
  if (!match) throw mediaError(422, "MEDIA_BASE64_INVALID", "图片 data URL 无效");
  const dataUrlMime = match[1].toLowerCase();
  if (dataUrlMime !== declaredMime) throw mediaError(415, "MEDIA_TYPE_MISMATCH", "图片声明类型不一致");
  return { buffer: strictBase64(match[2], maxBytes), dataUrlMime };
}

async function safeUnlink(filename) {
  if (!filename) return;
  await fsPromises.unlink(filename).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

/** Decodes, rotates, resizes and re-encodes public photos before any public read is possible. */
export function createMediaService({
  mediaRepository,
  uploadRoot,
  clock = createClock(),
  maxBytes = 8 * 1024 * 1024,
  maxPixels = 40_000_000,
  maxEdge = 2_000
}) {
  if (!mediaRepository) throw new Error("media service requires mediaRepository");
  if (!uploadRoot) throw new Error("media service requires uploadRoot");
  const privateRoot = path.join(uploadRoot, "private-originals");
  const publicRoot = path.join(uploadRoot, "public-derivatives");
  for (const directory of [uploadRoot, privateRoot, publicRoot]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }

  async function uploadPublic({ taskId, ownerId, mimeType, data, alt, publicConsent }) {
    const task = mediaRepository.taskForOwner(taskId, ownerId);
    if (!task || task.kind !== "supply") throw mediaError(404, "TASK_NOT_FOUND", "出租任务不存在");
    if (task.status !== "active" || task.expires_at <= clock.nowIso()) {
      throw mediaError(409, "TASK_NOT_ACTIVE", "只有有效出租任务可以添加公开照片");
    }
    if (publicConsent !== true) {
      throw mediaError(422, "PUBLIC_MEDIA_CONSENT_REQUIRED", "需要明确同意公开净化后的房源照片");
    }

    const declaredMime = String(mimeType || "").trim().toLowerCase();
    if (!EXTENSION_BY_MIME.has(declaredMime)) {
      throw mediaError(415, "MEDIA_TYPE_UNSUPPORTED", "公开房源照片只支持 JPEG、PNG 或 WebP");
    }
    const { buffer } = decodeInput(data, declaredMime, maxBytes);
    let metadata;
    try {
      metadata = await sharp(buffer, { animated: true, failOn: "error", limitInputPixels: maxPixels }).metadata();
    } catch {
      throw mediaError(422, "MEDIA_DECODE_FAILED", "图片无法安全解码");
    }
    const detectedMime = MIME_BY_FORMAT.get(metadata.format);
    if (!detectedMime) throw mediaError(415, "MEDIA_TYPE_UNSUPPORTED", "图片真实格式不受支持");
    if (detectedMime !== declaredMime) throw mediaError(415, "MEDIA_TYPE_MISMATCH", "文件头与声明的图片类型不一致");
    if (Number(metadata.pages || 1) > 1) throw mediaError(422, "MEDIA_ANIMATION_REJECTED", "不支持动画房源图片");
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) {
      throw mediaError(422, "MEDIA_PIXEL_LIMIT", "图片像素尺寸超过限制");
    }

    const originalSha256 = sha256(buffer);
    const duplicate = mediaRepository.findDuplicate(taskId, "public_listing", originalSha256);
    if (duplicate) return { media: publicMedia(duplicate), duplicate: true };

    let derivative;
    let info;
    try {
      const result = await sharp(buffer, { failOn: "error", limitInputPixels: maxPixels })
        .rotate()
        .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      derivative = result.data;
      info = result.info;
      const sanitizedMetadata = await sharp(derivative, { failOn: "error", limitInputPixels: maxPixels }).metadata();
      if (sanitizedMetadata.exif
        || sanitizedMetadata.xmp
        || sanitizedMetadata.iptc
        || sanitizedMetadata.icc
        || sanitizedMetadata.comments
        || sanitizedMetadata.orientation) {
        throw new Error("derivative metadata was not stripped");
      }
    } catch {
      throw mediaError(422, "MEDIA_PROCESSING_FAILED", "图片净化处理失败");
    }

    const id = randomUUID();
    const originalPath = path.join(privateRoot, `${id}${EXTENSION_BY_MIME.get(detectedMime)}`);
    const derivativePath = path.join(publicRoot, `${id}.webp`);
    try {
      await fsPromises.writeFile(originalPath, buffer, { mode: 0o600, flag: "wx" });
      await fsPromises.writeFile(derivativePath, derivative, { mode: 0o600, flag: "wx" });
      const at = clock.nowIso();
      const media = mediaRepository.insert({
        id,
        taskId,
        purpose: "public_listing",
        originalPath,
        derivativePath,
        detectedMime: "image/webp",
        sha256: originalSha256,
        derivativeSha256: sha256(derivative),
        width: info.width,
        height: info.height,
        alt: normalizedAlt(alt),
        reviewStatus: "approved",
        publicConsentAt: at,
        createdAt: at
      });
      return { media: publicMedia(media), duplicate: false };
    } catch (error) {
      await Promise.allSettled([safeUnlink(originalPath), safeUnlink(derivativePath)]);
      const raced = mediaRepository.findDuplicate(taskId, "public_listing", originalSha256);
      if (raced) return { media: publicMedia(raced), duplicate: true };
      throw error;
    }
  }

  return {
    uploadPublic,
    getReadable(id, ownerId) {
      const media = mediaRepository.readableBy(id, ownerId, clock.nowIso());
      if (!media) throw mediaError(404, "MEDIA_NOT_FOUND", "公开房源照片不存在");
      return {
        path: media.derivativePath,
        mimeType: media.detectedMime,
        etag: `"sha256-${media.derivativeSha256}"`
      };
    },
    deleteForTask(taskId, ownerId) {
      const task = mediaRepository.taskForOwner(taskId, ownerId);
      if (!task) throw mediaError(404, "TASK_NOT_FOUND", "任务不存在");
      return mediaRepository.softDeleteForTask(taskId, clock.nowIso());
    },
    async cleanupPending(limit = 50) {
      const jobs = mediaRepository.pendingCleanup(limit);
      for (const job of jobs) {
        try {
          await safeUnlink(job.originalPath);
          await safeUnlink(job.derivativePath);
          mediaRepository.markCleaned(job.id, clock.nowIso());
        } catch (error) {
          mediaRepository.markCleanupError(job.id, error.code || "CLEANUP_FAILED");
        }
      }
      return jobs.length;
    }
  };
}
