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

function fieldFromRow(row) {
  if (!row) return null;
  return {
    taskId: row.task_id,
    fieldKey: row.field_key,
    value: row.value_json === null ? null : parseJsonStrict(row.value_json, `task field ${row.task_id}.${row.field_key}`),
    source: row.source,
    confidence: row.confidence === null ? null : Number(row.confidence),
    confirmationStatus: row.confirmation_status,
    visibility: row.visibility,
    version: Number(row.version),
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
    insertEvent: db.prepare("INSERT INTO audit_events(task_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)"),
    fieldByKey: db.prepare("SELECT * FROM task_fields WHERE task_id = ? AND field_key = ?"),
    upsertField: db.prepare(`
      INSERT INTO task_fields(task_id, field_key, value_json, source, confidence, confirmation_status, visibility, version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id, field_key) DO UPDATE SET
        value_json = excluded.value_json,
        source = excluded.source,
        confidence = excluded.confidence,
        confirmation_status = excluded.confirmation_status,
        visibility = excluded.visibility,
        version = excluded.version,
        updated_at = excluded.updated_at
    `),
    updateTaskInput: db.prepare(`
      UPDATE tasks SET payload_json = ?, input_version = ?, updated_at = ?
      WHERE id = ? AND input_version = ?
    `),
    insertOutbox: db.prepare(`
      INSERT INTO outbox_events(id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key, status, available_at, created_at)
      VALUES (?, 'task', ?, 'task.match_requested', ?, ?, 'pending', ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING
    `)
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

  function applyFieldAnswer({ taskId, fieldKey, value, nextPayload, visibility = "matching_private", at = clock.nowIso() }) {
    return database.transaction(() => {
      const task = taskFromRow(statements.byId.get(taskId));
      if (!task) throw new Error("task not found");
      const currentField = fieldFromRow(statements.fieldByKey.get(taskId, fieldKey));
      const fieldVersion = Number(currentField?.version || 0) + 1;
      const inputVersion = task.inputVersion + 1;
      const payload = { ...nextPayload, inputVersion };
      const updated = statements.updateTaskInput.run(JSON.stringify(payload), inputVersion, at, taskId, task.inputVersion);
      if (!updated.changes) throw Object.assign(new Error("任务版本已变化"), { status: 409, code: "TASK_VERSION_CONFLICT" });
      statements.upsertField.run(
        taskId,
        fieldKey,
        JSON.stringify(value),
        "counterparty_answer",
        1,
        "confirmed",
        visibility,
        fieldVersion,
        at
      );
      statements.insertOutbox.run(
        randomUUID(),
        taskId,
        JSON.stringify({ taskId, inputVersion }),
        `task:${taskId}:input:${inputVersion}`,
        at,
        at
      );
      return { task: taskFromRow(statements.byId.get(taskId)), field: fieldFromRow(statements.fieldByKey.get(taskId, fieldKey)) };
    });
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
    getField: (taskId, fieldKey) => fieldFromRow(statements.fieldByKey.get(taskId, fieldKey)),
    applyFieldAnswer,
    upsertCandidate,
    removeCandidate,
    recordMatchRun,
    transaction: database.transaction
  };
}
