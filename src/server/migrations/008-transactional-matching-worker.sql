ALTER TABLE outbox_events ADD COLUMN locked_by TEXT;
ALTER TABLE outbox_events ADD COLUMN failed_at TEXT;

CREATE INDEX outbox_processing_lock_idx
ON outbox_events(status, locked_at);

CREATE TABLE match_jobs (
  job_key TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES outbox_events(id),
  renter_task_id TEXT NOT NULL,
  renter_input_version INTEGER NOT NULL,
  supply_task_id TEXT NOT NULL,
  supply_input_version INTEGER NOT NULL,
  evaluator_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing', 'completed', 'stale')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms REAL,
  stale_reason TEXT
);

CREATE INDEX match_jobs_event_idx ON match_jobs(event_id, status);
CREATE INDEX match_jobs_completed_idx ON match_jobs(completed_at, status);

CREATE TABLE worker_health (
  worker_name TEXT PRIMARY KEY,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error_code TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
