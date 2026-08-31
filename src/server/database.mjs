import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createClock } from "../clock.mjs";

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function taskFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    status: row.status,
    label: row.label,
    payload: parseJson(row.payload_json, {}),
    scanned: Number(row.scanned || 0),
    suitable: Number(row.suitable || 0),
    runCount: Number(row.run_count || 0),
    candidateVersion: Number(row.candidate_version || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMatchAt: row.last_match_at,
    expiresAt: row.expires_at
  };
}

function candidateFromRow(row) {
  return {
    id: row.id,
    receiverTaskId: row.receiver_task_id,
    counterpartyId: row.counterparty_id,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function openRentalDatabase(filename, { clock = createClock() } = {}) {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS tasks_kind_status_idx ON tasks(kind, status, created_at DESC);

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
  `);

  const statements = {
    createProfile: db.prepare("INSERT INTO profiles(id, token_hash, created_at) VALUES (?, ?, ?)"),
    profileByToken: db.prepare("SELECT * FROM profiles WHERE token_hash = ?"),
    insertSession: db.prepare(`
      INSERT INTO sessions(id, profile_id, token_hash, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    sessionByTokenHash: db.prepare(`
      SELECT id, profile_id, created_at, expires_at, last_seen_at
      FROM sessions
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
    `),
    touchSession: db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL"),
    revokeSession: db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL"),
    insertEvidence: db.prepare(`
      INSERT INTO evidence_uploads(id, owner_id, kind, storage_path, original_name, mime_type, sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    evidenceById: db.prepare("SELECT * FROM evidence_uploads WHERE id = ? AND owner_id = ?"),
    evidenceOwner: db.prepare("SELECT owner_id FROM evidence_uploads WHERE id = ?"),
    insertEvidenceReview: db.prepare(`
      INSERT INTO evidence_reviews(id, evidence_id, reviewer, method, result, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    latestEvidenceReview: db.prepare(`
      SELECT reviews.*
      FROM evidence_reviews AS reviews
      JOIN evidence_uploads AS evidence ON evidence.id = reviews.evidence_id
      WHERE reviews.evidence_id = ? AND evidence.owner_id = ?
      ORDER BY reviews.reviewed_at DESC, reviews.rowid DESC
      LIMIT 1
    `),
    insertTask: db.prepare(`
      INSERT INTO tasks(id, owner_id, kind, status, label, payload_json, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `),
    taskById: db.prepare("SELECT * FROM tasks WHERE id = ?"),
    tasksByOwner: db.prepare("SELECT * FROM tasks WHERE owner_id = ? ORDER BY created_at DESC"),
    activeTasksByKind: db.prepare("SELECT * FROM tasks WHERE kind = ? AND status = 'active' ORDER BY created_at ASC"),
    activeOppositeTasks: db.prepare("SELECT * FROM tasks WHERE kind = ? AND status = 'active' AND owner_id <> ? ORDER BY created_at ASC"),
    expiringTasks: db.prepare("SELECT id FROM tasks WHERE status = 'active' AND expires_at <= ?"),
    markTaskExpired: db.prepare("UPDATE tasks SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'active'"),
    updateTaskRun: db.prepare(`
      UPDATE tasks
      SET scanned = ?, suitable = ?, run_count = run_count + 1,
          candidate_version = candidate_version + ?, updated_at = ?, last_match_at = ?
      WHERE id = ?
    `),
    updateTaskStatus: db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?"),
    candidatesByTask: db.prepare("SELECT * FROM match_candidates WHERE receiver_task_id = ? ORDER BY created_at ASC"),
    candidateByPair: db.prepare("SELECT * FROM match_candidates WHERE receiver_task_id = ? AND counterparty_id = ?"),
    insertCandidate: db.prepare(`
      INSERT INTO match_candidates(id, receiver_task_id, counterparty_id, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    updateCandidate: db.prepare(`
      UPDATE match_candidates SET payload_json = ?, updated_at = ?
      WHERE receiver_task_id = ? AND counterparty_id = ?
    `),
    deleteCandidate: db.prepare("DELETE FROM match_candidates WHERE receiver_task_id = ? AND counterparty_id = ?"),
    insertEvent: db.prepare("INSERT INTO audit_events(task_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)"),
    eventsByTask: db.prepare("SELECT * FROM audit_events WHERE task_id = ? ORDER BY id DESC LIMIT ?")
  };

  function now() {
    return clock.nowIso();
  }

  function appendEvent(taskId, type, payload, at = now()) {
    statements.insertEvent.run(taskId, type, JSON.stringify(payload || {}), at);
  }

  return {
    raw: db,

    createProfile({ id, tokenHash }) {
      statements.createProfile.run(id, tokenHash, now());
      return { id };
    },

    findProfileByTokenHash(tokenHash) {
      const row = statements.profileByToken.get(tokenHash);
      return row ? { id: row.id, createdAt: row.created_at } : null;
    },

    createSession({ id, profileId, tokenHash, createdAt, expiresAt }) {
      statements.insertSession.run(id, profileId, tokenHash, createdAt, expiresAt, createdAt);
      return { id, profileId, createdAt, expiresAt, lastSeenAt: createdAt };
    },

    findSessionByTokenHash(tokenHash, at = now()) {
      const row = statements.sessionByTokenHash.get(tokenHash, at);
      return row
        ? {
            id: row.id,
            sessionId: row.id,
            profileId: row.profile_id,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            lastSeenAt: row.last_seen_at
          }
        : null;
    },

    touchSession(id, at = now()) {
      return statements.touchSession.run(at, id).changes > 0;
    },

    revokeSession(id, at = now()) {
      return statements.revokeSession.run(at, id).changes > 0;
    },

    addEvidence({ id, ownerId, kind, storagePath, originalName, mimeType, sha256 }) {
      statements.insertEvidence.run(id, ownerId, kind, storagePath, originalName, mimeType, sha256, now());
      return { id, kind };
    },

    getEvidence(id, ownerId) {
      const row = statements.evidenceById.get(id, ownerId);
      return row
        ? { id: row.id, ownerId: row.owner_id, kind: row.kind, storagePath: row.storage_path, mimeType: row.mime_type }
        : null;
    },

    getEvidenceOwner(id) {
      return statements.evidenceOwner.get(id)?.owner_id || null;
    },

    addEvidenceReview({ id = randomUUID(), evidenceId, reviewer, method, result, reviewedAt = now() }) {
      statements.insertEvidenceReview.run(id, evidenceId, reviewer, method, result, reviewedAt);
      return { id, evidenceId, reviewer, method, result, reviewedAt };
    },

    latestEvidenceReview(evidenceId, ownerId) {
      const row = statements.latestEvidenceReview.get(evidenceId, ownerId);
      return row
        ? {
            id: row.id,
            evidenceId: row.evidence_id,
            reviewer: row.reviewer,
            method: row.method,
            result: row.result,
            reviewedAt: row.reviewed_at
          }
        : null;
    },

    createTask({ id, ownerId, kind, label, payload, expiresAt }) {
      const at = now();
      statements.insertTask.run(id, ownerId, kind, label, JSON.stringify(payload), at, at, expiresAt);
      appendEvent(id, "task.created", { kind, label }, at);
      return this.getTask(id);
    },

    getTask(id) {
      return taskFromRow(statements.taskById.get(id));
    },

    listTasksForOwner(ownerId) {
      return statements.tasksByOwner.all(ownerId).map(taskFromRow);
    },

    listActiveTasks(kind = null) {
      if (kind) return statements.activeTasksByKind.all(kind).map(taskFromRow);
      return [
        ...statements.activeTasksByKind.all("renter"),
        ...statements.activeTasksByKind.all("supply")
      ].map(taskFromRow);
    },

    expireDueTasks(at = now()) {
      const due = statements.expiringTasks.all(at).map((row) => row.id);
      if (!due.length) return 0;
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const id of due) {
          const result = statements.markTaskExpired.run(at, id);
          if (result.changes) appendEvent(id, "task.expired", { status: "expired" }, at);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return due.length;
    },

    listOppositeTasks(kind, ownerId) {
      const opposite = kind === "renter" ? "supply" : "renter";
      return statements.activeOppositeTasks.all(opposite, ownerId).map(taskFromRow);
    },

    setTaskStatus(id, ownerId, status) {
      const at = now();
      const result = statements.updateTaskStatus.run(status, at, id, ownerId);
      if (result.changes) appendEvent(id, `task.${status}`, { status }, at);
      return result.changes ? this.getTask(id) : null;
    },

    replaceCandidates(taskId, candidates, scanned) {
      const at = now();
      const existing = statements.candidatesByTask.all(taskId).map(candidateFromRow);
      const incomingById = new Map(candidates.map((item) => [item.counterpartyId, item]));
      const existingById = new Map(existing.map((item) => [item.counterpartyId, item]));
      const added = [];
      let changed = false;

      db.exec("BEGIN IMMEDIATE");
      try {
        for (const item of candidates) {
          const payloadJson = JSON.stringify(item.payload);
          const previous = existingById.get(item.counterpartyId);
          if (!previous) {
            const id = randomUUID();
            statements.insertCandidate.run(id, taskId, item.counterpartyId, payloadJson, at, at);
            added.push({ id, ...item });
            changed = true;
          } else if (JSON.stringify(previous.payload) !== payloadJson) {
            statements.updateCandidate.run(payloadJson, at, taskId, item.counterpartyId);
            changed = true;
          }
        }

        for (const previous of existing) {
          if (incomingById.has(previous.counterpartyId)) continue;
          statements.deleteCandidate.run(taskId, previous.counterpartyId);
          changed = true;
        }

        statements.updateTaskRun.run(scanned, candidates.length, changed ? 1 : 0, at, at, taskId);
        if (changed) {
          appendEvent(taskId, "candidate.set_changed", {
            total: candidates.length,
            added: added.map((item) => item.counterpartyId)
          }, at);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      return { changed, added };
    },

    listCandidates(taskId) {
      return statements.candidatesByTask.all(taskId).map(candidateFromRow);
    },

    listEvents(taskId, limit = 30) {
      return statements.eventsByTask.all(taskId, Math.max(1, Math.min(100, Number(limit) || 30))).map((row) => ({
        id: row.id,
        type: row.type,
        payload: parseJson(row.payload_json, {}),
        createdAt: row.created_at
      }));
    },

    appendEvent,

    close() {
      db.close();
    }
  };
}
