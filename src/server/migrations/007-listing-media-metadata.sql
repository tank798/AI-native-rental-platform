ALTER TABLE listing_media ADD COLUMN derivative_sha256 TEXT;
ALTER TABLE listing_media ADD COLUMN width INTEGER;
ALTER TABLE listing_media ADD COLUMN height INTEGER;
ALTER TABLE listing_media ADD COLUMN alt_text TEXT;

CREATE UNIQUE INDEX listing_media_task_content_idx
ON listing_media(task_id, purpose, sha256)
WHERE deleted_at IS NULL;

CREATE INDEX listing_media_public_task_idx
ON listing_media(task_id, created_at)
WHERE purpose = 'public_listing' AND public_consent_at IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE media_cleanup_queue (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL,
  original_path TEXT NOT NULL,
  derivative_path TEXT,
  queued_at TEXT NOT NULL,
  cleaned_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error_code TEXT
);

CREATE INDEX media_cleanup_pending_idx
ON media_cleanup_queue(cleaned_at, queued_at);
