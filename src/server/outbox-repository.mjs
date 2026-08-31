import { randomUUID } from "node:crypto";

import { createClock, isoTimestampFromMilliseconds } from "../clock.mjs";

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} contains invalid JSON`, { cause: error });
  }
}

function eventFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: parseJson(row.payload_json, `outbox event ${row.id}`),
    dedupeKey: row.dedupe_key,
    status: row.status,
    attempts: Number(row.attempts),
    availableAt: row.available_at,
    lockedAt: row.locked_at || null,
    lockedBy: row.locked_by || null,
    createdAt: row.created_at,
    completedAt: row.completed_at || null,
    failedAt: row.failed_at || null
  };
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

/** SQLite lease and retry boundary for the single-process matching worker. */
export function createOutboxRepository({
  database,
  clock = createClock(),
  lockTtlMs = 30_000,
  maxAttempts = 5,
  baseBackoffMs = 1_000
}) {
  if (!database?.raw || !database?.transaction) throw new Error("outbox repository requires an open rental database");
  const db = database.raw;
  const statements = {
    byId: db.prepare("SELECT * FROM outbox_events WHERE id = ?"),
    byDedupe: db.prepare("SELECT * FROM outbox_events WHERE dedupe_key = ?"),
    enqueue: db.prepare(`
      INSERT INTO outbox_events(
        id, aggregate_type, aggregate_id, event_type, payload_json,
        dedupe_key, status, available_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING
    `),
    claimable: db.prepare(`
      SELECT * FROM outbox_events
      WHERE status = 'pending' AND available_at <= ?
      ORDER BY available_at ASC, created_at ASC, id ASC
      LIMIT ?
    `),
    claim: db.prepare(`
      UPDATE outbox_events
      SET status = 'processing', locked_at = ?, locked_by = ?
      WHERE id = ? AND status = 'pending' AND available_at <= ?
    `),
    complete: db.prepare(`
      UPDATE outbox_events
      SET status = 'completed', completed_at = ?, locked_at = NULL,
          locked_by = NULL, last_error_code = NULL
      WHERE id = ? AND status = 'processing' AND locked_by = ?
    `),
    retry: db.prepare(`
      UPDATE outbox_events
      SET status = 'pending', attempts = ?, available_at = ?, locked_at = NULL,
          locked_by = NULL, last_error_code = ?
      WHERE id = ? AND status = 'processing' AND locked_by = ?
    `),
    fail: db.prepare(`
      UPDATE outbox_events
      SET status = 'failed', attempts = ?, failed_at = ?, locked_at = NULL,
          locked_by = NULL, last_error_code = ?
      WHERE id = ? AND status = 'processing' AND locked_by = ?
    `),
    requeueExpired: db.prepare(`
      UPDATE outbox_events
      SET status = 'pending', locked_at = NULL, locked_by = NULL,
          last_error_code = COALESCE(last_error_code, 'LOCK_EXPIRED')
      WHERE status = 'processing' AND locked_at <= ?
    `),
    counts: db.prepare("SELECT status, COUNT(*) AS count FROM outbox_events GROUP BY status"),
    activeStaleTasks: db.prepare(`
      SELECT tasks.* FROM tasks
      WHERE tasks.status = 'active' AND tasks.expires_at > ?
        AND (tasks.last_matched_at IS NULL OR tasks.last_matched_at <= ?)
        AND NOT EXISTS (
          SELECT 1 FROM outbox_events
          WHERE aggregate_type = 'task' AND aggregate_id = tasks.id
            AND status IN ('pending', 'processing')
        )
      ORDER BY tasks.updated_at ASC
      LIMIT ?
    `),
    alert: db.prepare(`
      INSERT INTO audit_events(task_id, type, payload_json, created_at)
      SELECT ?, 'worker.match_failed', ?, ?
      WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?)
    `),
    insertJob: db.prepare(`
      INSERT INTO match_jobs(
        job_key, event_id, renter_task_id, renter_input_version,
        supply_task_id, supply_input_version, evaluator_version,
        status, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?)
      ON CONFLICT(job_key) DO NOTHING
    `),
    jobByKey: db.prepare("SELECT * FROM match_jobs WHERE job_key = ?"),
    resumeJob: db.prepare(`
      UPDATE match_jobs SET status = 'processing', started_at = ?,
        completed_at = NULL, duration_ms = NULL, stale_reason = NULL
      WHERE job_key = ? AND event_id = ? AND status = 'processing'
    `),
    completeJob: db.prepare(`
      UPDATE match_jobs SET status = 'completed', completed_at = ?, duration_ms = ?
      WHERE job_key = ? AND status = 'processing'
    `),
    staleJob: db.prepare(`
      UPDATE match_jobs SET status = 'stale', completed_at = ?, duration_ms = ?, stale_reason = ?
      WHERE job_key = ? AND status = 'processing'
    `),
    durations: db.prepare("SELECT duration_ms FROM match_jobs WHERE status = 'completed' AND duration_ms IS NOT NULL ORDER BY completed_at DESC LIMIT 1000"),
    healthByName: db.prepare("SELECT * FROM worker_health WHERE worker_name = ?"),
    successHealth: db.prepare(`
      INSERT INTO worker_health(worker_name, last_success_at, metrics_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(worker_name) DO UPDATE SET
        last_success_at = excluded.last_success_at,
        metrics_json = excluded.metrics_json,
        updated_at = excluded.updated_at
    `),
    errorHealth: db.prepare(`
      INSERT INTO worker_health(worker_name, last_error_at, last_error_code, metrics_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(worker_name) DO UPDATE SET
        last_error_at = excluded.last_error_at,
        last_error_code = excluded.last_error_code,
        metrics_json = excluded.metrics_json,
        updated_at = excluded.updated_at
    `)
  };

  function enqueue({
    aggregateType = "task",
    aggregateId,
    eventType = "task.match_requested",
    payload = {},
    dedupeKey,
    availableAt = clock.nowIso()
  }) {
    const id = randomUUID();
    const at = clock.nowIso();
    const inserted = statements.enqueue.run(
      id,
      aggregateType,
      aggregateId,
      eventType,
      JSON.stringify(payload),
      dedupeKey,
      availableAt,
      at
    ).changes > 0;
    return { ...eventFromRow(statements.byDedupe.get(dedupeKey)), enqueued: inserted };
  }

  function claimBatch(workerId, limit = 20) {
    const at = clock.nowIso();
    return database.transaction(() => {
      const rows = statements.claimable.all(at, Math.max(1, Math.min(100, Number(limit) || 20)));
      const claimed = [];
      for (const row of rows) {
        if (statements.claim.run(at, workerId, row.id, at).changes) {
          claimed.push(eventFromRow(statements.byId.get(row.id)));
        }
      }
      return claimed;
    });
  }

  function markFailure(eventId, workerId, error) {
    const current = eventFromRow(statements.byId.get(eventId));
    if (!current || current.status !== "processing" || current.lockedBy !== workerId) return { terminal: false, changed: false };
    const attempts = current.attempts + 1;
    const at = clock.nowIso();
    const errorCode = String(error?.code || "MATCH_WORKER_ERROR").slice(0, 100);
    if (attempts >= maxAttempts) {
      const changed = database.transaction(() => {
        const updated = statements.fail.run(attempts, at, errorCode, eventId, workerId).changes > 0;
        if (updated) {
          statements.alert.run(
            current.aggregateId,
            JSON.stringify({ outboxEventId: eventId, attempts, errorCode }),
            at,
            current.aggregateId
          );
        }
        return updated;
      });
      return { terminal: changed, changed, attempts, errorCode };
    }
    const delay = Math.min(60_000, baseBackoffMs * 2 ** Math.max(0, attempts - 1));
    const availableAt = isoTimestampFromMilliseconds(clock.nowMs() + delay);
    const changed = statements.retry.run(attempts, availableAt, errorCode, eventId, workerId).changes > 0;
    return { terminal: false, changed, attempts, errorCode, availableAt };
  }

  function beginMatchJob({
    jobKey,
    eventId,
    renterTaskId,
    renterInputVersion,
    supplyTaskId,
    supplyInputVersion,
    evaluatorVersion
  }) {
    const at = clock.nowIso();
    statements.insertJob.run(
      jobKey,
      eventId,
      renterTaskId,
      renterInputVersion,
      supplyTaskId,
      supplyInputVersion,
      evaluatorVersion,
      at
    );
    const row = statements.jobByKey.get(jobKey);
    if (row.status === "completed" || row.status === "stale") return { shouldProcess: false, status: row.status };
    if (row.event_id !== eventId) return { shouldProcess: false, status: "processing" };
    statements.resumeJob.run(at, jobKey, eventId);
    return { shouldProcess: true, status: "processing", startedAt: at };
  }

  function recordSuccess(workerName, metrics = {}) {
    const at = clock.nowIso();
    statements.successHealth.run(workerName, at, JSON.stringify(metrics), at);
  }

  function recordError(workerName, error, metrics = {}) {
    const at = clock.nowIso();
    statements.errorHealth.run(
      workerName,
      at,
      String(error?.code || "MATCH_WORKER_ERROR").slice(0, 100),
      JSON.stringify(metrics),
      at
    );
  }

  return {
    enqueue,
    enqueueTaskMatch(taskId, inputVersion, options = {}) {
      return enqueue({
        aggregateId: taskId,
        eventType: options.eventType || "task.match_requested",
        payload: { taskId, inputVersion, ...(options.payload || {}) },
        dedupeKey: options.dedupeKey || `task:${taskId}:input:${inputVersion}`,
        availableAt: options.availableAt
      });
    },
    get: (id) => eventFromRow(statements.byId.get(id)),
    claimBatch,
    complete(eventId, workerId) {
      return statements.complete.run(clock.nowIso(), eventId, workerId).changes > 0;
    },
    markFailure,
    requeueExpired() {
      const cutoff = isoTimestampFromMilliseconds(clock.nowMs() - lockTtlMs);
      return statements.requeueExpired.run(cutoff).changes;
    },
    beginMatchJob,
    completeMatchJob(jobKey, durationMs = 0) {
      return statements.completeJob.run(clock.nowIso(), Math.max(0, Number(durationMs) || 0), jobKey).changes > 0;
    },
    markMatchJobStale(jobKey, reason, durationMs = 0) {
      return statements.staleJob.run(
        clock.nowIso(),
        Math.max(0, Number(durationMs) || 0),
        String(reason || "task_version_changed").slice(0, 100),
        jobKey
      ).changes > 0;
    },
    compensateUnmatched({ olderThanMs = 60_000, limit = 100 } = {}) {
      const at = clock.nowIso();
      const cutoff = isoTimestampFromMilliseconds(clock.nowMs() - olderThanMs);
      const bucket = at.slice(0, 16);
      const tasks = statements.activeStaleTasks.all(at, cutoff, Math.max(1, Math.min(500, Number(limit) || 100)));
      let enqueued = 0;
      for (const task of tasks) {
        const event = enqueue({
          aggregateId: task.id,
          eventType: "task.match_compensated",
          payload: { taskId: task.id, inputVersion: Number(task.input_version), reason: "missing_pending_event" },
          dedupeKey: `task:${task.id}:input:${task.input_version}:compensate:${bucket}`
        });
        enqueued += event.enqueued ? 1 : 0;
      }
      return enqueued;
    },
    recordSuccess,
    recordError,
    health(workerName = "matching") {
      const counts = Object.fromEntries(statements.counts.all().map((row) => [row.status, Number(row.count)]));
      const row = statements.healthByName.get(workerName);
      const durations = statements.durations.all().map((item) => Number(item.duration_ms));
      return {
        pending: counts.pending || 0,
        processing: counts.processing || 0,
        completed: counts.completed || 0,
        failed: counts.failed || 0,
        lastSuccessAt: row?.last_success_at || null,
        lastErrorAt: row?.last_error_at || null,
        lastErrorCode: row?.last_error_code || null,
        metrics: row ? parseJson(row.metrics_json, `worker health ${workerName}`) : {},
        jobP50Ms: percentile(durations, 0.5),
        jobP95Ms: percentile(durations, 0.95)
      };
    }
  };
}
