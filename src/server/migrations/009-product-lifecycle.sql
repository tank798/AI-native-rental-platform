ALTER TABLE tasks ADD COLUMN lifecycle_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE viewing_appointments ADD COLUMN responder_owner_id TEXT REFERENCES profiles(id);
ALTER TABLE viewing_appointments ADD COLUMN responded_at TEXT;
ALTER TABLE viewing_appointments ADD COLUMN cancel_reason TEXT;

CREATE TABLE product_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  actor_owner_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  payload_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX product_events_type_created_idx ON product_events(type, created_at);
CREATE INDEX product_events_aggregate_idx ON product_events(aggregate_id, created_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX notifications_owner_unread_idx ON notifications(owner_id, read_at, created_at DESC);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  reporter_owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason_code TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX reports_case_created_idx ON reports(match_case_id, created_at DESC);

