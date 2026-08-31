ALTER TABLE tasks ADD COLUMN input_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN client_request_id TEXT;
ALTER TABLE tasks ADD COLUMN last_matched_at TEXT;

UPDATE tasks
SET input_version = CAST(json_extract(payload_json, '$.inputVersion') AS INTEGER)
WHERE json_valid(payload_json)
  AND json_type(payload_json, '$.inputVersion') = 'integer'
  AND CAST(json_extract(payload_json, '$.inputVersion') AS INTEGER) >= 1;

UPDATE tasks SET last_matched_at = last_match_at WHERE last_match_at IS NOT NULL;

CREATE UNIQUE INDEX tasks_owner_client_request_idx
ON tasks(owner_id, client_request_id)
WHERE client_request_id IS NOT NULL;

CREATE TABLE task_fields (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value_json TEXT,
  source TEXT NOT NULL CHECK(source IN (
    'user_text', 'ai_inferred', 'user_confirmed', 'counterparty_answer',
    'map_service', 'document_submitted', 'manual_review', 'third_party_verification'
  )),
  confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  confirmation_status TEXT NOT NULL CHECK(confirmation_status IN ('proposed', 'confirmed', 'conflicted', 'unknown')),
  visibility TEXT NOT NULL CHECK(visibility IN ('owner_private', 'matching_private', 'case_public', 'market_public')),
  version INTEGER NOT NULL CHECK(version >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(task_id, field_key)
);

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  available_at TEXT NOT NULL,
  locked_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX outbox_status_available_idx ON outbox_events(status, available_at);
