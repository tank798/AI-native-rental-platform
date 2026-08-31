ALTER TABLE party_confirmations RENAME TO party_confirmations_legacy;

CREATE TABLE party_confirmations (
  id TEXT PRIMARY KEY,
  match_case_id TEXT NOT NULL REFERENCES match_cases(id) ON DELETE CASCADE,
  party TEXT NOT NULL CHECK(party IN ('renter', 'supply')),
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  terms_version INTEGER NOT NULL CHECK(terms_version >= 1),
  terms_hash TEXT NOT NULL,
  renter_input_version INTEGER NOT NULL CHECK(renter_input_version >= 1),
  supply_input_version INTEGER NOT NULL CHECK(supply_input_version >= 1),
  decision TEXT NOT NULL CHECK(decision IN ('confirmed', 'declined')),
  confirmed_at TEXT NOT NULL,
  revoked_at TEXT
);

INSERT INTO party_confirmations(
  id, match_case_id, party, owner_id, terms_version, terms_hash,
  renter_input_version, supply_input_version, decision, confirmed_at, revoked_at
)
SELECT legacy.match_case_id || ':' || legacy.party || ':' || legacy.terms_version,
       legacy.match_case_id, legacy.party, legacy.owner_id, legacy.terms_version, legacy.terms_hash,
       cases.renter_input_version, cases.supply_input_version,
       legacy.decision, legacy.confirmed_at, legacy.revoked_at
FROM party_confirmations_legacy AS legacy
JOIN match_cases AS cases ON cases.id = legacy.match_case_id;

DROP TABLE party_confirmations_legacy;

CREATE UNIQUE INDEX confirmation_active_party_idx
ON party_confirmations(match_case_id, party)
WHERE revoked_at IS NULL;

CREATE INDEX confirmation_case_history_idx
ON party_confirmations(match_case_id, confirmed_at);
