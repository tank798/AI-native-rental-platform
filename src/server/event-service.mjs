import { randomUUID } from "node:crypto";

import { createClock } from "../clock.mjs";

const PRIVATE_NAMES = new Set([
  "contact",
  "hardmax",
  "minrent",
  "exactaddress",
  "rawtext",
  "evidencepath",
  "sessiontoken"
]);

const EVENT_SCHEMAS = Object.freeze({
  "task.activated": ["kind", "inputVersion", "lifecycleVersion"],
  "task.renewed": ["inputVersion", "lifecycleVersion", "expiresAt"],
  "task.paused": ["inputVersion"],
  "task.closed": ["inputVersion"],
  "task.expired": ["inputVersion"],
  "task.expiring": ["expiresAt", "hoursRemaining"],
  "candidate.created": ["candidateCount", "latencyMs"],
  "clarification.requested": ["party", "questionCount", "termsVersion"],
  "clarification.completed": ["party", "questionCount", "latencyMs"],
  "terms.ready": ["termsVersion", "latencyMs"],
  "confirmation.recorded": ["party", "termsVersion", "latencyMs"],
  "contact.unlocked": ["termsVersion"],
  "contact.revoked": ["reason", "termsVersion"],
  "contact.viewed": ["party", "termsVersion"],
  "viewing.proposed": ["scheduledAt", "party"],
  "viewing.accepted": ["scheduledAt", "party"],
  "viewing.rejected": ["scheduledAt", "party"],
  "viewing.cancelled": ["reason"],
  "report.created": ["reasonCode"],
  // 人工核验结果。只记录 approved/rejected，不得写入材料内容、
  // 文件名或审核备注，以免隐私信息进入可导出的事件流。
  "evidence.reviewed": ["result", "reviewer"]
});

function assertPublicPayload(value, path = "payload") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicPayload(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      const normalized = value.replace(/[^a-z]/giu, "").toLowerCase();
      if ([...PRIVATE_NAMES].some((name) => normalized.includes(name))) throw new Error(`${path} contains a private field name`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z]/giu, "").toLowerCase();
    if (PRIVATE_NAMES.has(normalized)) throw new Error(`${path}.${key} is private`);
    assertPublicPayload(child, `${path}.${key}`);
  }
}

function validateEvent(input) {
  const allowed = EVENT_SCHEMAS[input?.type];
  if (!allowed) throw new Error("unsupported product event type");
  if (!String(input.aggregateId || "").trim()) throw new Error("aggregateId is required");
  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload : {};
  assertPublicPayload(payload);
  const unknown = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`event payload contains unsupported keys: ${unknown.join(", ")}`);
  return { ...input, payload };
}

function eventFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    aggregateId: row.aggregate_id,
    actorOwnerId: row.actor_owner_id,
    payload: JSON.parse(row.payload_json),
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at
  };
}

/** Writes privacy-allowlisted product events for aggregate metrics. */
export function createEventService({ database, clock = createClock() }) {
  if (!database?.raw || !database?.transaction) throw new Error("event service requires an open rental database");
  const db = database.raw;
  const statements = {
    insert: db.prepare(`
      INSERT INTO product_events(id, type, aggregate_id, actor_owner_id, payload_json, dedupe_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING
    `),
    byDedupe: db.prepare("SELECT * FROM product_events WHERE dedupe_key = ?"),
    all: db.prepare("SELECT * FROM product_events ORDER BY created_at ASC, rowid ASC")
  };

  function record(input) {
    const event = validateEvent(input);
    const dedupeKey = String(event.dedupeKey || `${event.type}:${event.aggregateId}:${clock.nowIso()}`);
    const id = randomUUID();
    const createdAt = event.createdAt || clock.nowIso();
    const inserted = statements.insert.run(
      id,
      event.type,
      event.aggregateId,
      event.actorOwnerId || null,
      JSON.stringify(event.payload),
      dedupeKey,
      createdAt
    ).changes > 0;
    return { ...eventFromRow(statements.byDedupe.get(dedupeKey)), inserted };
  }

  return {
    record,
    list: () => statements.all.all().map(eventFromRow),
    validate: validateEvent,
    assertPublicPayload
  };
}

export { EVENT_SCHEMAS };
