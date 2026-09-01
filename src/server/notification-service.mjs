import { randomUUID } from "node:crypto";

import { createClock, isoTimestampFromMilliseconds } from "../clock.mjs";

export const NOTIFICATION_TYPES = new Set([
  "new_candidate",
  "clarification_needed",
  "terms_ready",
  "other_confirmed",
  "contact_unlocked",
  "contact_revoked",
  "task_expiring",
  "viewing_proposed",
  "viewing_accepted",
  "viewing_rejected",
  "viewing_cancelled"
]);

const PAYLOAD_KEYS = new Set(["title", "message", "taskId", "matchCaseId", "expiresAt", "scheduledAt"]);

function notificationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    aggregateId: row.aggregate_id,
    payload: JSON.parse(row.payload_json),
    readAt: row.read_at,
    createdAt: row.created_at
  };
}

function safePayload(payload = {}) {
  const unknown = Object.keys(payload).filter((key) => !PAYLOAD_KEYS.has(key));
  if (unknown.length) throw new Error(`notification payload contains unsupported keys: ${unknown.join(", ")}`);
  const encoded = JSON.stringify(payload);
  if (/hardMax|minRent|exactAddress|rawText|evidencePath|sessionToken|contact/iu.test(encoded)) {
    throw new Error("notification payload contains private data");
  }
  return payload;
}

/** Persists owner-scoped, deduplicated in-app notifications. */
export function createNotificationService({ database, clock = createClock() }) {
  if (!database?.raw || !database?.transaction) throw new Error("notification service requires an open rental database");
  const db = database.raw;
  const statements = {
    insert: db.prepare(`
      INSERT INTO notifications(id, owner_id, type, aggregate_id, payload_json, dedupe_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING
    `),
    byDedupe: db.prepare("SELECT * FROM notifications WHERE dedupe_key = ?"),
    list: db.prepare("SELECT * FROM notifications WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?"),
    unread: db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE owner_id = ? AND read_at IS NULL"),
    markRead: db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND owner_id = ? AND read_at IS NULL"),
    markAllRead: db.prepare("UPDATE notifications SET read_at = ? WHERE owner_id = ? AND read_at IS NULL"),
    expiring: db.prepare(`
      SELECT * FROM tasks
      WHERE owner_id = ? AND status = 'active' AND expires_at > ? AND expires_at <= ?
    `),
    cases: db.prepare(`
      SELECT cases.*, renter.owner_id AS renter_owner_id, supply.owner_id AS supply_owner_id
      FROM match_cases AS cases
      JOIN tasks AS renter ON renter.id = cases.renter_task_id
      JOIN tasks AS supply ON supply.id = cases.supply_task_id
      WHERE renter.owner_id = ? OR supply.owner_id = ?
    `),
    openClarifications: db.prepare(`
      SELECT COUNT(*) AS count FROM clarification_requests
      WHERE match_case_id = ? AND target_party = ? AND status = 'open'
    `),
    otherConfirmation: db.prepare(`
      SELECT 1 AS present FROM party_confirmations
      WHERE match_case_id = ? AND party = ? AND decision = 'confirmed' AND revoked_at IS NULL
      LIMIT 1
    `),
    grant: db.prepare("SELECT * FROM contact_grants WHERE match_case_id = ? ORDER BY granted_at DESC LIMIT 1"),
    owners: db.prepare("SELECT id FROM profiles")
  };

  function notify({ ownerId, type, aggregateId, payload = {}, dedupeKey, createdAt = clock.nowIso() }) {
    if (!NOTIFICATION_TYPES.has(type)) throw new Error("unsupported notification type");
    if (!ownerId || !aggregateId || !dedupeKey) throw new Error("notification identity is required");
    const publicPayload = safePayload(payload);
    const id = randomUUID();
    const inserted = statements.insert.run(id, ownerId, type, aggregateId, JSON.stringify(publicPayload), dedupeKey, createdAt).changes > 0;
    return { ...notificationFromRow(statements.byDedupe.get(dedupeKey)), inserted };
  }

  function syncOwner(ownerId, { expiringWithinHours = 48 } = {}) {
    const now = clock.nowIso();
    const deadline = isoTimestampFromMilliseconds(clock.now().getTime() + expiringWithinHours * 60 * 60 * 1000);
    for (const task of statements.expiring.all(ownerId, now, deadline)) {
      notify({
        ownerId,
        type: "task_expiring",
        aggregateId: task.id,
        dedupeKey: `task-expiring:${task.id}:${task.lifecycle_version}`,
        payload: { title: "任务即将到期", message: task.label, taskId: task.id, expiresAt: task.expires_at }
      });
    }
    for (const matchCase of statements.cases.all(ownerId, ownerId)) {
      const party = matchCase.renter_owner_id === ownerId ? "renter" : "supply";
      const otherParty = party === "renter" ? "supply" : "renter";
      notify({
        ownerId,
        type: "new_candidate",
        aggregateId: matchCase.id,
        dedupeKey: `candidate:${ownerId}:${matchCase.id}`,
        payload: { title: "出现新的合适候选", message: "打开后查看公开匹配条件", matchCaseId: matchCase.id }
      });
      const openCount = Number(statements.openClarifications.get(matchCase.id, party)?.count || 0);
      if (openCount) notify({
        ownerId,
        type: "clarification_needed",
        aggregateId: matchCase.id,
        dedupeKey: `clarification:${ownerId}:${matchCase.id}:${matchCase.current_terms_version || 0}`,
        payload: { title: "需要你补充信息", message: `${openCount} 项条件待确认`, matchCaseId: matchCase.id }
      });
      if (["terms_ready", "awaiting_confirmations", "mutually_confirmed"].includes(matchCase.status)) notify({
        ownerId,
        type: "terms_ready",
        aggregateId: matchCase.id,
        dedupeKey: `terms:${ownerId}:${matchCase.id}:${matchCase.current_terms_version}`,
        payload: { title: "匹配条款已准备", message: "请确认当前公开条款", matchCaseId: matchCase.id }
      });
      if (statements.otherConfirmation.get(matchCase.id, otherParty)) notify({
        ownerId,
        type: "other_confirmed",
        aggregateId: matchCase.id,
        dedupeKey: `other-confirmed:${ownerId}:${matchCase.id}:${matchCase.current_terms_version}`,
        payload: { title: "对方已确认", message: "等待你确认同一版条款", matchCaseId: matchCase.id }
      });
      const grant = statements.grant.get(matchCase.id);
      if (grant && !grant.revoked_at) notify({
        ownerId,
        type: "contact_unlocked",
        aggregateId: matchCase.id,
        dedupeKey: `grant:${ownerId}:${grant.id}`,
        payload: { title: "联系方式已解锁", message: "可以提出看房时间", matchCaseId: matchCase.id, expiresAt: grant.expires_at }
      });
      if (grant?.revoked_at) notify({
        ownerId,
        type: "contact_revoked",
        aggregateId: matchCase.id,
        dedupeKey: `grant-revoked:${ownerId}:${grant.id}`,
        payload: { title: "联系授权已撤销", message: "匹配条件或任务状态已变化", matchCaseId: matchCase.id }
      });
    }
  }

  return {
    notify,
    syncOwner,
    syncAll() {
      for (const row of statements.owners.all()) syncOwner(row.id);
    },
    list(ownerId, limit = 50) {
      syncOwner(ownerId);
      const items = statements.list.all(ownerId, Math.max(1, Math.min(100, Number(limit) || 50))).map(notificationFromRow);
      return { notifications: items, unreadCount: Number(statements.unread.get(ownerId).count) };
    },
    unreadCount: (ownerId) => Number(statements.unread.get(ownerId).count),
    markRead(id, ownerId) {
      statements.markRead.run(clock.nowIso(), id, ownerId);
      return notificationFromRow(db.prepare("SELECT * FROM notifications WHERE id = ? AND owner_id = ?").get(id, ownerId));
    },
    markAllRead(ownerId) {
      return statements.markAllRead.run(clock.nowIso(), ownerId).changes;
    }
  };
}
