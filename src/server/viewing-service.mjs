import { randomUUID } from "node:crypto";

import { createClock } from "../clock.mjs";

function serviceError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function appointmentFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    matchCaseId: row.match_case_id,
    proposedBy: row.proposed_by,
    startsAt: row.starts_at,
    status: row.status,
    responderOwnerId: row.responder_owner_id,
    respondedAt: row.responded_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Allows one auditable viewing proposal only while a live contact grant exists. */
export function createViewingService({ database, matchCaseRepository, contactGrantService, eventService = null, notificationService = null, clock = createClock() }) {
  if (!database?.raw || !database?.transaction) throw new Error("viewing service requires an open rental database");
  if (!matchCaseRepository || !contactGrantService) throw new Error("viewing service requires match and grant services");
  const db = database.raw;
  const statements = {
    insert: db.prepare(`
      INSERT INTO viewing_appointments(id, match_case_id, proposed_by, starts_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'proposed', ?, ?)
    `),
    byId: db.prepare("SELECT * FROM viewing_appointments WHERE id = ?"),
    pendingForCase: db.prepare("SELECT * FROM viewing_appointments WHERE match_case_id = ? AND status = 'proposed' ORDER BY created_at DESC LIMIT 1"),
    listForCase: db.prepare("SELECT * FROM viewing_appointments WHERE match_case_id = ? ORDER BY created_at DESC"),
    respond: db.prepare(`
      UPDATE viewing_appointments SET status = ?, responder_owner_id = ?, responded_at = ?, updated_at = ?
      WHERE id = ? AND status = 'proposed'
    `),
    cancel: db.prepare(`
      UPDATE viewing_appointments SET status = 'cancelled', cancel_reason = ?, updated_at = ?
      WHERE id = ? AND status = 'proposed'
    `),
    pending: db.prepare("SELECT * FROM viewing_appointments WHERE status = 'proposed'")
  };

  function participant(matchCaseId, ownerId) {
    const item = matchCaseRepository.participant(matchCaseId, ownerId);
    if (!item) throw serviceError(404, "MATCH_CASE_NOT_FOUND", "匹配案例不存在");
    return item;
  }

  function otherOwner(item) {
    return item.party === "renter" ? item.supplyOwnerId : item.renterOwnerId;
  }

  function propose({ matchCaseId, ownerId, startsAt }) {
    const proposer = participant(matchCaseId, ownerId);
    if (!contactGrantService.isUnlocked(matchCaseId, ownerId)) throw serviceError(409, "VIEWING_GRANT_REQUIRED", "联系授权有效后才能提出看房时间");
    const timestamp = new Date(startsAt);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.getTime() <= clock.now().getTime()) {
      throw serviceError(422, "VIEWING_TIME_INVALID", "看房时间必须是未来的 ISO 时间");
    }
    const existing = statements.pendingForCase.get(matchCaseId);
    if (existing) return { appointment: appointmentFromRow(existing), idempotent: true };
    const id = randomUUID();
    const at = clock.nowIso();
    statements.insert.run(id, matchCaseId, proposer.party, timestamp.toISOString(), at, at);
    eventService?.record({ type: "viewing.proposed", aggregateId: matchCaseId, actorOwnerId: ownerId, payload: { scheduledAt: timestamp.toISOString(), party: proposer.party }, dedupeKey: `viewing-proposed:${id}` });
    notificationService?.notify({ ownerId: otherOwner(proposer), type: "viewing_proposed", aggregateId: matchCaseId, payload: { title: "收到看房提议", message: "请接受或拒绝这个时间", matchCaseId, scheduledAt: timestamp.toISOString() }, dedupeKey: `viewing-proposed:${id}:${otherOwner(proposer)}` });
    return { appointment: appointmentFromRow(statements.byId.get(id)), idempotent: false };
  }

  function respond({ appointmentId, ownerId, decision }) {
    if (!['accepted', 'rejected'].includes(decision)) throw serviceError(422, "VIEWING_DECISION_INVALID", "看房决定无效");
    const current = appointmentFromRow(statements.byId.get(appointmentId));
    if (!current) throw serviceError(404, "VIEWING_NOT_FOUND", "看房提议不存在");
    const participantRecord = participant(current.matchCaseId, ownerId);
    if (participantRecord.party === current.proposedBy) throw serviceError(403, "VIEWING_SELF_RESPONSE", "不能回应自己提出的时间");
    if (!contactGrantService.isUnlocked(current.matchCaseId, ownerId)) throw serviceError(409, "VIEWING_GRANT_REQUIRED", "联系授权已经失效");
    if (current.status !== "proposed") return { appointment: current, idempotent: true };
    const at = clock.nowIso();
    statements.respond.run(decision, ownerId, at, at, appointmentId);
    eventService?.record({ type: `viewing.${decision}`, aggregateId: current.matchCaseId, actorOwnerId: ownerId, payload: { scheduledAt: current.startsAt, party: participantRecord.party }, dedupeKey: `viewing-${decision}:${appointmentId}` });
    const proposerOwnerId = otherOwner(participantRecord);
    notificationService?.notify({ ownerId: proposerOwnerId, type: `viewing_${decision}`, aggregateId: current.matchCaseId, payload: { title: decision === "accepted" ? "看房时间已接受" : "看房时间未被接受", message: current.startsAt, matchCaseId: current.matchCaseId, scheduledAt: current.startsAt }, dedupeKey: `viewing-${decision}:${appointmentId}:${proposerOwnerId}` });
    return { appointment: appointmentFromRow(statements.byId.get(appointmentId)), idempotent: false };
  }

  function cancelForCase(matchCaseId, reason = "grant_invalid") {
    const current = appointmentFromRow(statements.pendingForCase.get(matchCaseId));
    if (!current) return null;
    const at = clock.nowIso();
    statements.cancel.run(reason, at, current.id);
    eventService?.record({ type: "viewing.cancelled", aggregateId: matchCaseId, payload: { reason }, dedupeKey: `viewing-cancelled:${current.id}` });
    return appointmentFromRow(statements.byId.get(current.id));
  }

  function cancelInvalid() {
    let cancelled = 0;
    for (const row of statements.pending.all()) {
      const appointment = appointmentFromRow(row);
      const anyOwner = db.prepare(`
        SELECT renter.owner_id AS owner_id FROM match_cases AS cases
        JOIN tasks AS renter ON renter.id = cases.renter_task_id WHERE cases.id = ?
      `).get(appointment.matchCaseId)?.owner_id;
      if (!anyOwner || !contactGrantService.isUnlocked(appointment.matchCaseId, anyOwner)) {
        cancelForCase(appointment.matchCaseId, "grant_invalid");
        cancelled += 1;
      }
    }
    return cancelled;
  }

  return {
    propose,
    respond,
    cancelForCase,
    cancelInvalid,
    listForCase(matchCaseId, ownerId) {
      participant(matchCaseId, ownerId);
      return statements.listForCase.all(matchCaseId).map(appointmentFromRow);
    }
  };
}
