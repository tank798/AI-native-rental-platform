CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_uploads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS sessions_profile_idx ON sessions(profile_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS evidence_reviews (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence_uploads(id) ON DELETE CASCADE,
  reviewer TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method = 'manual_review'),
  result TEXT NOT NULL CHECK(result IN ('approved', 'rejected')),
  reviewed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS evidence_reviews_latest_idx ON evidence_reviews(evidence_id, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('renter', 'supply')),
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'closed', 'expired')),
  label TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  scanned INTEGER NOT NULL DEFAULT 0,
  suitable INTEGER NOT NULL DEFAULT 0,
  run_count INTEGER NOT NULL DEFAULT 0,
  candidate_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_match_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_owner_status_idx ON tasks(owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_kind_status_idx ON tasks(kind, status, created_at ASC);

CREATE TABLE IF NOT EXISTS match_candidates (
  id TEXT PRIMARY KEY,
  receiver_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  counterparty_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(receiver_task_id, counterparty_id)
);

CREATE INDEX IF NOT EXISTS candidates_receiver_idx ON match_candidates(receiver_task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_task_idx ON audit_events(task_id, id DESC);
