import { randomUUID } from "node:crypto";
import { createClock } from "../clock.mjs";

function parseJsonStrict(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} contains invalid JSON`, { cause: error });
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
    payload: parseJsonStrict(row.payload_json, `task ${row.id}`),
    inputVersion: Number(row.input_version),
    scanned: Number(row.scanned),
    suitable: Number(row.suitable),
    runCount: Number(row.run_count),
    candidateVersion: Number(row.candidate_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMatchedAt: row.last_matched_at || row.last_match_at,
    expiresAt: row.expires_at
  };
}

function candidateFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    receiverTaskId: row.receiver_task_id,
    counterpartyId: row.counterparty_id,
    payload: parseJsonStrict(row.payload_json, `candidate ${row.id}`),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Prepared-statement boundary for versioned tasks and pair projections. */
export function createTaskRepository({ database, clock = createClock() }) {
  if (!database?.raw || !database?.transaction) throw new Error("task repository requires an open rental database");
  const db = database.raw;
  const statements = {
    byId: db.prepare("SELECT * FROM tasks WHERE id = ?"),
    activeByKind: db.prepare("SELECT * FROM tasks WHERE kind = ? AND status = 'active' ORDER BY created_at ASC"),
    opposite: db.prepare("SELECT * FROM tasks WHERE kind = ? AND status = 'active' AND owner_id <> ? ORDER BY created_at ASC"),
    inactiveWithCases: db.prepare(`
      SELECT DISTINCT tasks.* FROM tasks
      JOIN match_cases ON match_cases.renter_task_id = tasks.id OR match_cases.supply_task_id = tasks.id
      WHERE tasks.status <> 'active'
    `),
    candidates: db.prepare("SELECT * FROM match_candidates WHERE receiver_task_id = ? ORDER BY created_at ASC"),
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
    updateMatchRun: db.prepare(`
      UPDATE tasks
      SET scanned = ?, suitable = ?, run_count = run_count + 1,
          candidate_version = candidate_version + ?, updated_at = ?,
          last_match_at = ?, last_matched_at = ?
      WHERE id = ?
    `),
    insertEvent: db.prepare("INSERT INTO audit_events(task_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)")
  };

  function upsertCandidate(receiverTaskId, counterpartyId, payload, at = clock.nowIso()) {
    const payloadJson = JSON.stringify(payload);
    const current = statements.candidateByPair.get(receiverTaskId, counterpartyId);
    if (!current) {
      statements.insertCandidate.run(randomUUID(), receiverTaskId, counterpartyId, payloadJson, at, at);
      return true;
    }
    if (current.payload_json === payloadJson) return false;
    statements.updateCandidate.run(payloadJson, at, receiverTaskId, counterpartyId);
    return true;
  }

  function removeCandidate(receiverTaskId, counterpartyId) {
    return statements.deleteCandidate.run(receiverTaskId, counterpartyId).changes > 0;
  }

  function recordMatchRun(taskId, { scanned, changed }, at = clock.nowIso()) {
    const suitable = statements.candidates.all(taskId).length;
    statements.updateMatchRun.run(scanned, suitable, changed ? 1 : 0, at, at, at, taskId);
    if (changed) {
      statements.insertEvent.run(taskId, "candidate.set_changed", JSON.stringify({ total: suitable }), at);
    }
    return taskFromRow(statements.byId.get(taskId));
  }

  return {
    get: (id) => taskFromRow(statements.byId.get(id)),
    listActive: (kind) => statements.activeByKind.all(kind).map(taskFromRow),
    listOpposite(task) {
      const oppositeKind = task.kind === "renter" ? "supply" : "renter";
      return statements.opposite.all(oppositeKind, task.ownerId).map(taskFromRow);
    },
    listInactiveWithCases: () => statements.inactiveWithCases.all().map(taskFromRow),
    listCandidates: (taskId) => statements.candidates.all(taskId).map(candidateFromRow),
    upsertCandidate,
    removeCandidate,
    recordMatchRun,
    transaction: database.transaction
  };
}
