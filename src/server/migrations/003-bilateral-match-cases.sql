CREATE TABLE match_cases (
  id TEXT PRIMARY KEY,
  renter_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  supply_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN (
    'potential', 'clarifying', 'terms_ready', 'awaiting_confirmations',
    'mutually_confirmed', 'declined', 'invalidated', 'expired',
    'viewing_scheduled', 'closed'
  )),
  renter_input_version INTEGER NOT NULL CHECK(renter_input_version >= 1),
  supply_input_version INTEGER NOT NULL CHECK(supply_input_version >= 1),
  current_terms_version INTEGER,
  terminal_reason TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(renter_task_id, supply_task_id),
  CHECK(renter_task_id <> supply_task_id)
);

CREATE TABLE match_terms (
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  terms_hash TEXT NOT NULL,
  public_terms_json TEXT NOT NULL,
  blocking_unknowns_json TEXT NOT NULL,
  non_blocking_unknowns_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  invalidated_at TEXT,
  PRIMARY KEY(match_case_id, version),
  UNIQUE(match_case_id, terms_hash)
);

CREATE TABLE clarification_requests (
  id TEXT PRIMARY KEY,
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  terms_version INTEGER,
  target_party TEXT NOT NULL CHECK(target_party IN ('renter', 'supply')),
  field_key TEXT NOT NULL,
  question TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open', 'answered', 'dismissed', 'superseded')),
  raw_answer TEXT,
  structured_answer_json TEXT,
  created_at TEXT NOT NULL,
  answered_at TEXT
);

CREATE UNIQUE INDEX clarification_open_field_idx
ON clarification_requests(match_case_id, target_party, field_key)
WHERE status = 'open';

CREATE TABLE party_confirmations (
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  party TEXT NOT NULL CHECK(party IN ('renter', 'supply')),
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  terms_version INTEGER NOT NULL CHECK(terms_version >= 1),
  terms_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('confirmed', 'declined')),
  confirmed_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY(match_case_id, party, terms_version)
);

CREATE TABLE profile_contacts (
  owner_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL CHECK(contact_type IN ('wechat', 'phone', 'email')),
  encrypted_value TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE contact_grants (
  id TEXT PRIMARY KEY,
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  terms_version INTEGER NOT NULL CHECK(terms_version >= 1),
  renter_owner_id TEXT NOT NULL REFERENCES profiles(id),
  supply_owner_id TEXT NOT NULL REFERENCES profiles(id),
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT,
  UNIQUE(match_case_id, terms_version)
);

CREATE TABLE listing_media (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('public_listing', 'private_evidence')),
  original_path TEXT NOT NULL,
  derivative_path TEXT,
  detected_mime TEXT,
  sha256 TEXT NOT NULL,
  review_status TEXT NOT NULL,
  public_consent_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE viewing_appointments (
  id TEXT PRIMARY KEY,
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  proposed_by TEXT NOT NULL CHECK(proposed_by IN ('renter', 'supply')),
  starts_at TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE match_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  actor_owner_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX match_events_case_idx ON match_events(match_case_id, id DESC);
