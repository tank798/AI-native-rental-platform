ALTER TABLE contact_grants RENAME TO contact_grants_legacy;

CREATE TABLE contact_grants (
  id TEXT PRIMARY KEY,
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  terms_version INTEGER NOT NULL CHECK(terms_version >= 1),
  terms_hash TEXT NOT NULL,
  renter_input_version INTEGER NOT NULL CHECK(renter_input_version >= 1),
  supply_input_version INTEGER NOT NULL CHECK(supply_input_version >= 1),
  renter_owner_id TEXT NOT NULL REFERENCES profiles(id),
  supply_owner_id TEXT NOT NULL REFERENCES profiles(id),
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT
);

INSERT INTO contact_grants(
  id, match_case_id, terms_version, terms_hash, renter_input_version, supply_input_version,
  renter_owner_id, supply_owner_id, granted_at, expires_at, revoked_at, revoke_reason
)
SELECT legacy.id, legacy.match_case_id, legacy.terms_version, terms.terms_hash,
       cases.renter_input_version, cases.supply_input_version,
       legacy.renter_owner_id, legacy.supply_owner_id, legacy.granted_at, legacy.expires_at,
       legacy.revoked_at, legacy.revoke_reason
FROM contact_grants_legacy AS legacy
JOIN match_cases AS cases ON cases.id = legacy.match_case_id
JOIN match_terms AS terms
  ON terms.match_case_id = legacy.match_case_id AND terms.version = legacy.terms_version;

DROP TABLE contact_grants_legacy;

CREATE UNIQUE INDEX contact_grant_active_case_idx
ON contact_grants(match_case_id)
WHERE revoked_at IS NULL;

CREATE INDEX contact_grant_case_history_idx
ON contact_grants(match_case_id, granted_at);
