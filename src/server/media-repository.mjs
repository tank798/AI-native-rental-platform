import { randomUUID } from "node:crypto";
import { createClock } from "../clock.mjs";

function mediaFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    purpose: row.purpose,
    originalPath: row.original_path,
    derivativePath: row.derivative_path,
    detectedMime: row.detected_mime,
    sha256: row.sha256,
    derivativeSha256: row.derivative_sha256,
    width: Number(row.width || 0),
    height: Number(row.height || 0),
    alt: row.alt_text || "房源公开实拍",
    reviewStatus: row.review_status,
    publicConsentAt: row.public_consent_at,
    createdAt: row.created_at,
    deletedAt: row.deleted_at
  };
}

export function publicMedia(media) {
  return {
    id: media.id,
    src: `/api/media/${encodeURIComponent(media.id)}`,
    alt: media.alt,
    width: media.width,
    height: media.height
  };
}

/** Keeps storage paths private while exposing owner- and candidate-scoped media queries. */
export function createMediaRepository({ database, clock = createClock() }) {
  if (!database?.raw || !database?.transaction) throw new Error("media repository requires an open rental database");
  const db = database.raw;
  const statements = {
    taskForOwner: db.prepare("SELECT id, owner_id, kind, status, expires_at FROM tasks WHERE id = ? AND owner_id = ?"),
    byId: db.prepare("SELECT * FROM listing_media WHERE id = ?"),
    duplicate: db.prepare(`
      SELECT * FROM listing_media
      WHERE task_id = ? AND purpose = ? AND sha256 = ? AND deleted_at IS NULL
      LIMIT 1
    `),
    insert: db.prepare(`
      INSERT INTO listing_media(
        id, task_id, purpose, original_path, derivative_path, detected_mime,
        sha256, derivative_sha256, width, height, alt_text, review_status,
        public_consent_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    publicForTask: db.prepare(`
      SELECT media.* FROM listing_media AS media
      JOIN tasks ON tasks.id = media.task_id
      WHERE media.task_id = ?
        AND media.purpose = 'public_listing'
        AND media.review_status = 'approved'
        AND media.public_consent_at IS NOT NULL
        AND media.derivative_path IS NOT NULL
        AND media.deleted_at IS NULL
        AND tasks.status = 'active'
        AND tasks.expires_at > ?
      ORDER BY media.created_at ASC, media.id ASC
    `),
    readable: db.prepare(`
      SELECT media.* FROM listing_media AS media
      JOIN tasks AS supply ON supply.id = media.task_id
      WHERE media.id = ?
        AND media.purpose = 'public_listing'
        AND media.review_status = 'approved'
        AND media.public_consent_at IS NOT NULL
        AND media.derivative_path IS NOT NULL
        AND media.deleted_at IS NULL
        AND supply.status = 'active'
        AND supply.expires_at > ?
        AND (
          supply.owner_id = ?
          OR EXISTS (
            SELECT 1 FROM match_candidates AS candidate
            JOIN tasks AS receiver ON receiver.id = candidate.receiver_task_id
            WHERE candidate.counterparty_id = media.task_id
              AND receiver.owner_id = ?
              AND receiver.status = 'active'
              AND receiver.expires_at > ?
          )
        )
      LIMIT 1
    `),
    taskMedia: db.prepare("SELECT * FROM listing_media WHERE task_id = ? AND deleted_at IS NULL"),
    markDeleted: db.prepare("UPDATE listing_media SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL"),
    enqueueCleanup: db.prepare(`
      INSERT INTO media_cleanup_queue(
        id, media_id, task_id, original_path, derivative_path, queued_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(media_id) DO NOTHING
    `),
    pendingCleanup: db.prepare(`
      SELECT * FROM media_cleanup_queue
      WHERE cleaned_at IS NULL
      ORDER BY queued_at ASC, id ASC
      LIMIT ?
    `),
    markCleaned: db.prepare("UPDATE media_cleanup_queue SET cleaned_at = ?, last_error_code = NULL WHERE id = ? AND cleaned_at IS NULL"),
    markCleanupError: db.prepare(`
      UPDATE media_cleanup_queue
      SET attempts = attempts + 1, last_error_code = ?
      WHERE id = ? AND cleaned_at IS NULL
    `),
    cleanupForMedia: db.prepare("SELECT * FROM media_cleanup_queue WHERE media_id = ?")
  };

  return {
    taskForOwner: (taskId, ownerId) => statements.taskForOwner.get(taskId, ownerId) || null,
    get: (id) => mediaFromRow(statements.byId.get(id)),
    findDuplicate: (taskId, purpose, hash) => mediaFromRow(statements.duplicate.get(taskId, purpose, hash)),
    insert(input) {
      statements.insert.run(
        input.id,
        input.taskId,
        input.purpose,
        input.originalPath,
        input.derivativePath,
        input.detectedMime,
        input.sha256,
        input.derivativeSha256,
        input.width,
        input.height,
        input.alt,
        input.reviewStatus,
        input.publicConsentAt,
        input.createdAt
      );
      return mediaFromRow(statements.byId.get(input.id));
    },
    listPublicForTask(taskId, at = clock.nowIso()) {
      return statements.publicForTask.all(taskId, at).map(mediaFromRow).map(publicMedia);
    },
    readableBy(id, ownerId, at = clock.nowIso()) {
      return mediaFromRow(statements.readable.get(id, at, ownerId, ownerId, at));
    },
    softDeleteForTask(taskId, at = clock.nowIso()) {
      return database.transaction(() => {
        const rows = statements.taskMedia.all(taskId);
        for (const row of rows) {
          if (!statements.markDeleted.run(at, row.id).changes) continue;
          statements.enqueueCleanup.run(
            randomUUID(),
            row.id,
            row.task_id,
            row.original_path,
            row.derivative_path,
            at
          );
        }
        return rows.length;
      });
    },
    pendingCleanup(limit = 50) {
      return statements.pendingCleanup.all(Math.max(1, Math.min(200, Number(limit) || 50))).map((row) => ({
        id: row.id,
        mediaId: row.media_id,
        taskId: row.task_id,
        originalPath: row.original_path,
        derivativePath: row.derivative_path,
        attempts: Number(row.attempts),
        queuedAt: row.queued_at
      }));
    },
    markCleaned: (id, at = clock.nowIso()) => statements.markCleaned.run(at, id).changes > 0,
    markCleanupError: (id, code) => statements.markCleanupError.run(String(code || "CLEANUP_FAILED").slice(0, 80), id).changes > 0,
    cleanupForMedia: (mediaId) => statements.cleanupForMedia.get(mediaId) || null
  };
}
