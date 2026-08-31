import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { createClock } from "../clock.mjs";
import { latestSchemaVersion, runMigrations } from "./migrations.mjs";

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
    inputVersion: Number(row.input_version || 1),
    clientRequestId: row.client_request_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMatchAt: row.last_matched_at || row.last_match_at,
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

function configureConnection(database) {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}

function prepareStorage(filename) {
  if (filename === ":memory:") return;
  const directory = path.dirname(path.resolve(filename));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function secureDatabaseFile(filename) {
  if (filename !== ":memory:" && fs.existsSync(filename)) fs.chmodSync(filename, 0o600);
}

function hasUserTables(database) {
  return Boolean(database.prepare(`
    SELECT 1 AS present
    FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    LIMIT 1
  `).get());
}

function backupBeforeMigration(database, filename) {
  if (filename === ":memory:" || !hasUserTables(database)) return { database, backupPath: null };
  const currentVersion = Number(database.prepare("PRAGMA user_version").get().user_version || 0);
  if (currentVersion >= latestSchemaVersion) return { database, backupPath: null };
  database.exec("PRAGMA wal_checkpoint(FULL)");
  database.close();
  const backupPath = `${filename}.pre-v${currentVersion}.bak`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(filename, backupPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backupPath, 0o600);
  const reopened = new DatabaseSync(filename);
  configureConnection(reopened);
  return { database: reopened, backupPath };
}

export function openRentalDatabase(filename, { clock = createClock() } = {}) {
  prepareStorage(filename);
  let db = new DatabaseSync(filename);
  configureConnection(db);
  const prepared = backupBeforeMigration(db, filename);
  db = prepared.database;
  runMigrations(db);
  secureDatabaseFile(filename);

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
    deleteExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
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
      INSERT INTO tasks(id, owner_id, kind, status, label, payload_json, input_version, client_request_id, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
    `),
    taskById: db.prepare("SELECT * FROM tasks WHERE id = ?"),
    taskByClientRequest: db.prepare("SELECT * FROM tasks WHERE owner_id = ? AND client_request_id = ?"),
    tasksByOwner: db.prepare("SELECT * FROM tasks WHERE owner_id = ? ORDER BY created_at DESC"),
    activeTasksByKind: db.prepare("SELECT * FROM tasks WHERE kind = ? AND status = 'active' AND expires_at > ? ORDER BY created_at ASC"),
    activeOppositeTasks: db.prepare("SELECT * FROM tasks WHERE kind = ? AND status = 'active' AND expires_at > ? AND owner_id <> ? ORDER BY created_at ASC"),
    expiringTasks: db.prepare("SELECT * FROM tasks WHERE status = 'active' AND expires_at <= ?"),
    markTaskExpired: db.prepare(`
      UPDATE tasks SET status = 'expired', payload_json = ?, input_version = ?, updated_at = ?
      WHERE id = ? AND status = 'active' AND input_version = ?
    `),
    updateTaskRun: db.prepare(`
      UPDATE tasks
      SET scanned = ?, suitable = ?, run_count = run_count + 1,
          candidate_version = candidate_version + ?, updated_at = ?, last_match_at = ?, last_matched_at = ?
      WHERE id = ?
    `),
    updateTaskStatus: db.prepare(`
      UPDATE tasks SET status = ?, payload_json = ?, input_version = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND input_version = ?
    `),
    deleteTask: db.prepare("DELETE FROM tasks WHERE id = ? AND owner_id = ?"),
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
    insertOutbox: db.prepare(`
      INSERT INTO outbox_events(
        id, aggregate_type, aggregate_id, event_type, payload_json,
        dedupe_key, status, available_at, created_at
      ) VALUES (?, 'task', ?, ?, ?, ?, 'pending', ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING
    `),
    eventsByTask: db.prepare("SELECT * FROM audit_events WHERE task_id = ? ORDER BY id DESC LIMIT ?")
  };

  function now() {
    return clock.nowIso();
  }

  function appendEvent(taskId, type, payload, at = now()) {
    statements.insertEvent.run(taskId, type, JSON.stringify(payload || {}), at);
  }

  function enqueueTaskEvent(taskId, inputVersion, eventType, at, dedupeKey = `task:${taskId}:input:${inputVersion}`) {
    statements.insertOutbox.run(
      randomUUID(),
      taskId,
      eventType,
      JSON.stringify({ taskId, inputVersion }),
      dedupeKey,
      at,
      at
    );
  }

  function transaction(work) {
    const nested = Boolean(db.isTransaction);
    const savepoint = `sp_${randomUUID().replaceAll("-", "")}`;
    db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
      return result;
    } catch (error) {
      db.exec(nested ? `ROLLBACK TO SAVEPOINT ${savepoint}` : "ROLLBACK");
      if (nested) db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }

  return {
    raw: db,
    migrationBackupPath: prepared.backupPath,
    transaction,

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

    cleanupExpiredSessions(at = now()) {
      return statements.deleteExpiredSessions.run(at).changes;
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

    createTaskIdempotent({ id, ownerId, kind, label, payload, expiresAt, inputVersion = payload?.inputVersion || 1, clientRequestId = null }) {
      const startedAt = performance.now();
      const result = transaction(() => {
        if (clientRequestId) {
          const replay = statements.taskByClientRequest.get(ownerId, clientRequestId);
          if (replay) {
            if (replay.kind !== kind) {
              throw Object.assign(new Error("clientRequestId 已用于另一类任务"), {
                status: 409,
                code: "CLIENT_REQUEST_CONFLICT"
              });
            }
            return { task: taskFromRow(replay), created: false };
          }
        }
        const at = now();
        const normalizedPayload = { ...(payload || {}), inputVersion };
        statements.insertTask.run(
          id,
          ownerId,
          kind,
          label,
          JSON.stringify(normalizedPayload),
          inputVersion,
          clientRequestId,
          at,
          at,
          expiresAt
        );
        appendEvent(id, "task.created", { kind, label }, at);
        enqueueTaskEvent(id, inputVersion, "task.match_requested", at);
        return { task: taskFromRow(statements.taskById.get(id)), created: true };
      });
      return { ...result, enqueueLatencyMs: performance.now() - startedAt };
    },

    createTask(input) {
      return this.createTaskIdempotent(input).task;
    },

    getTask(id) {
      return taskFromRow(statements.taskById.get(id));
    },

    listTasksForOwner(ownerId) {
      return statements.tasksByOwner.all(ownerId).map(taskFromRow);
    },

    listActiveTasks(kind = null) {
      const at = now();
      if (kind) return statements.activeTasksByKind.all(kind, at).map(taskFromRow);
      return [
        ...statements.activeTasksByKind.all("renter", at),
        ...statements.activeTasksByKind.all("supply", at)
      ].map(taskFromRow);
    },

    expireDueTasks(at = now()) {
      const due = statements.expiringTasks.all(at);
      if (!due.length) return 0;
      return transaction(() => {
        let expired = 0;
        for (const row of due) {
          const inputVersion = Number(row.input_version) + 1;
          const payload = { ...parseJson(row.payload_json, {}), inputVersion };
          const result = statements.markTaskExpired.run(JSON.stringify(payload), inputVersion, at, row.id, row.input_version);
          if (result.changes) {
            appendEvent(row.id, "task.expired", { status: "expired", inputVersion }, at);
            enqueueTaskEvent(row.id, inputVersion, "task.match_invalidated", at);
            expired += 1;
          }
        }
        return expired;
      });
    },

    listOppositeTasks(kind, ownerId) {
      const opposite = kind === "renter" ? "supply" : "renter";
      return statements.activeOppositeTasks.all(opposite, now(), ownerId).map(taskFromRow);
    },

    setTaskStatus(id, ownerId, status) {
      return transaction(() => {
        const current = taskFromRow(statements.taskById.get(id));
        if (!current || current.ownerId !== ownerId) return null;
        if (current.status === status) return current;
        const at = now();
        const inputVersion = current.inputVersion + 1;
        const payload = { ...current.payload, inputVersion };
        const result = statements.updateTaskStatus.run(
          status,
          JSON.stringify(payload),
          inputVersion,
          at,
          id,
          ownerId,
          current.inputVersion
        );
        if (!result.changes) return null;
        appendEvent(id, `task.${status}`, { status, inputVersion }, at);
        enqueueTaskEvent(
          id,
          inputVersion,
          status === "active" ? "task.match_requested" : "task.match_invalidated",
          at
        );
        return taskFromRow(statements.taskById.get(id));
      });
    },

    bumpTaskInputVersion(id, ownerId, reason = "task_input_changed") {
      return transaction(() => {
        const current = taskFromRow(statements.taskById.get(id));
        if (!current || current.ownerId !== ownerId) return null;
        const at = now();
        const inputVersion = current.inputVersion + 1;
        const payload = { ...current.payload, inputVersion };
        const updated = statements.updateTaskStatus.run(
          current.status,
          JSON.stringify(payload),
          inputVersion,
          at,
          id,
          ownerId,
          current.inputVersion
        );
        if (!updated.changes) return null;
        appendEvent(id, reason, { inputVersion }, at);
        enqueueTaskEvent(
          id,
          inputVersion,
          current.status === "active" ? "task.match_requested" : "task.match_invalidated",
          at
        );
        return taskFromRow(statements.taskById.get(id));
      });
    },

    deleteTask(id, ownerId) {
      return statements.deleteTask.run(id, ownerId).changes > 0;
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

        statements.updateTaskRun.run(scanned, candidates.length, changed ? 1 : 0, at, at, at, taskId);
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
