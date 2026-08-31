import { createHash, randomUUID } from "node:crypto";
import { createClock } from "../clock.mjs";

const FORBIDDEN_PUBLIC_KEYS = /^(?:hardMax|minimumAuthorizedRent|minRent|exactAddress|address|rawText|evidenceRefs|storagePath|contact|sessionToken|token)$/iu;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function assertPublicValue(value, path = "public") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((item, index) => assertPublicValue(item, `${path}.${index}`));
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.test(key)) throw new Error(`private field cannot enter ${path}: ${key}`);
    assertPublicValue(nested, `${path}.${key}`);
  }
}

function hashTerms(payload) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function parseJsonStrict(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} contains invalid JSON`, { cause: error });
  }
}

function caseFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    renterTaskId: row.renter_task_id,
    supplyTaskId: row.supply_task_id,
    status: row.status,
    renterInputVersion: Number(row.renter_input_version),
    supplyInputVersion: Number(row.supply_input_version),
    currentTermsVersion: row.current_terms_version === null ? null : Number(row.current_terms_version),
    terminalReason: row.terminal_reason || null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function clarificationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    matchCaseId: row.match_case_id,
    termsVersion: row.terms_version === null ? null : Number(row.terms_version),
    targetParty: row.target_party,
    fieldKey: row.field_key,
    question: row.question,
    reasonCode: row.reason_code,
    priority: Number(row.priority),
    status: row.status,
    answerSpec: parseJsonStrict(row.answer_spec_json || "{}", `clarification spec ${row.id}`),
    rawAnswer: row.raw_answer,
    structuredAnswer: row.structured_answer_json ? parseJsonStrict(row.structured_answer_json, `clarification answer ${row.id}`) : null,
    createdAt: row.created_at,
    answeredAt: row.answered_at || null
  };
}

/** Persists the unique, participant-scoped state for one real task pair. */
export function createMatchCaseRepository({ database, clock = createClock() }) {
  if (!database?.raw || !database?.transaction) throw new Error("match case repository requires an open rental database");
  const db = database.raw;
  const statements = {
    taskPair: db.prepare(`
      SELECT renter.id AS renter_id, renter.owner_id AS renter_owner_id, renter.kind AS renter_kind, renter.status AS renter_status,
             supply.id AS supply_id, supply.owner_id AS supply_owner_id, supply.kind AS supply_kind, supply.status AS supply_status
      FROM tasks AS renter JOIN tasks AS supply ON renter.id = ? AND supply.id = ?
    `),
    byId: db.prepare("SELECT * FROM match_cases WHERE id = ?"),
    byPair: db.prepare("SELECT * FROM match_cases WHERE renter_task_id = ? AND supply_task_id = ?"),
    forOwner: db.prepare(`
      SELECT cases.* FROM match_cases AS cases
      JOIN tasks AS renter ON renter.id = cases.renter_task_id
      JOIN tasks AS supply ON supply.id = cases.supply_task_id
      WHERE cases.id = ? AND (renter.owner_id = ? OR supply.owner_id = ?)
    `),
    all: db.prepare("SELECT * FROM match_cases ORDER BY created_at ASC"),
    insert: db.prepare(`
      INSERT INTO match_cases(id, renter_task_id, supply_task_id, status, renter_input_version, supply_input_version,
                              current_terms_version, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      ON CONFLICT(renter_task_id, supply_task_id) DO NOTHING
    `),
    update: db.prepare(`
      UPDATE match_cases
      SET status = ?, renter_input_version = ?, supply_input_version = ?, current_terms_version = ?,
          terminal_reason = NULL, expires_at = ?, updated_at = ?
      WHERE id = ?
    `),
    invalidate: db.prepare(`
      UPDATE match_cases SET status = ?, terminal_reason = ?, updated_at = ?
      WHERE id = ? AND status NOT IN ('declined', 'expired', 'closed')
    `),
    casesForTask: db.prepare("SELECT * FROM match_cases WHERE renter_task_id = ? OR supply_task_id = ?"),
    latestTermsVersion: db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM match_terms WHERE match_case_id = ?"),
    termsByHash: db.prepare("SELECT * FROM match_terms WHERE match_case_id = ? AND terms_hash = ?"),
    termsByVersion: db.prepare("SELECT * FROM match_terms WHERE match_case_id = ? AND version = ?"),
    insertTerms: db.prepare(`
      INSERT INTO match_terms(match_case_id, version, terms_hash, public_terms_json, blocking_unknowns_json,
                              non_blocking_unknowns_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    reactivateTerms: db.prepare("UPDATE match_terms SET invalidated_at = NULL WHERE match_case_id = ? AND version = ?"),
    invalidateOtherTerms: db.prepare("UPDATE match_terms SET invalidated_at = ? WHERE match_case_id = ? AND version <> ? AND invalidated_at IS NULL"),
    insertEvent: db.prepare("INSERT INTO match_events(match_case_id, actor_owner_id, type, payload_json, created_at) VALUES (?, NULL, ?, ?, ?)"),
    events: db.prepare("SELECT * FROM match_events WHERE match_case_id = ? ORDER BY id ASC"),
    participant: db.prepare(`
      SELECT CASE WHEN renter.owner_id = ? THEN 'renter' WHEN supply.owner_id = ? THEN 'supply' END AS party
      FROM match_cases AS cases
      JOIN tasks AS renter ON renter.id = cases.renter_task_id
      JOIN tasks AS supply ON supply.id = cases.supply_task_id
      WHERE cases.id = ? AND (renter.owner_id = ? OR supply.owner_id = ?)
    `),
    clarifications: db.prepare("SELECT * FROM clarification_requests WHERE match_case_id = ? ORDER BY priority DESC, created_at ASC"),
    clarificationById: db.prepare("SELECT * FROM clarification_requests WHERE id = ? AND match_case_id = ?"),
    clarificationForOwner: db.prepare(`
      SELECT requests.* FROM clarification_requests AS requests
      JOIN match_cases AS cases ON cases.id = requests.match_case_id
      JOIN tasks AS renter ON renter.id = cases.renter_task_id
      JOIN tasks AS supply ON supply.id = cases.supply_task_id
      WHERE requests.id = ? AND requests.match_case_id = ?
        AND ((requests.target_party = 'renter' AND renter.owner_id = ?)
          OR (requests.target_party = 'supply' AND supply.owner_id = ?))
    `),
    insertClarification: db.prepare(`
      INSERT INTO clarification_requests(id, match_case_id, terms_version, target_party, field_key, question,
                                         reason_code, priority, status, answer_spec_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
      ON CONFLICT DO NOTHING
    `),
    updateOpenClarification: db.prepare(`
      UPDATE clarification_requests
      SET terms_version = ?, question = ?, reason_code = ?, priority = ?, answer_spec_json = ?
      WHERE match_case_id = ? AND target_party = ? AND field_key = ? AND status = 'open'
    `),
    supersedeClarification: db.prepare("UPDATE clarification_requests SET status = 'superseded' WHERE id = ? AND status = 'open'"),
    answeredField: db.prepare(`
      SELECT 1 AS answered FROM clarification_requests
      WHERE match_case_id = ? AND target_party = ? AND field_key = ? AND status = 'answered'
      LIMIT 1
    `),
    answerClarification: db.prepare(`
      UPDATE clarification_requests
      SET status = 'answered', raw_answer = ?, structured_answer_json = ?, answered_at = ?
      WHERE id = ? AND status = 'open'
    `)
  };

  function assertPair(renterTaskId, supplyTaskId) {
    const pair = statements.taskPair.get(renterTaskId, supplyTaskId);
    if (!pair || pair.renter_kind !== "renter" || pair.supply_kind !== "supply") throw new Error("match case requires a renter task and a supply task");
    if (pair.renter_owner_id === pair.supply_owner_id) throw new Error("same owner tasks cannot form a match case");
    if (pair.renter_status !== "active" || pair.supply_status !== "active") throw new Error("match case requires active tasks");
    return pair;
  }

  function termsFor(row) {
    if (!row?.current_terms_version) return null;
    const terms = statements.termsByVersion.get(row.id, row.current_terms_version);
    return terms ? {
      version: Number(terms.version),
      hash: terms.terms_hash,
      publicTerms: parseJsonStrict(terms.public_terms_json, `match terms ${row.id}`),
      blockingUnknowns: parseJsonStrict(terms.blocking_unknowns_json, `blocking unknowns ${row.id}`),
      nonBlockingUnknowns: parseJsonStrict(terms.non_blocking_unknowns_json, `non-blocking unknowns ${row.id}`)
    } : null;
  }

  function hydrate(row) {
    const matchCase = caseFromRow(row);
    return matchCase ? { ...matchCase, terms: termsFor(row) } : null;
  }

  function upsertEvaluation({ renterTask, supplyTask, evaluation, expiresAt }) {
    if (evaluation.status === "hard_conflict") return null;
    assertPair(renterTask.id, supplyTask.id);
    const publicRecord = {
      publicTerms: evaluation.termsProposal,
      blockingUnknowns: evaluation.blockingUnknowns,
      nonBlockingUnknowns: evaluation.nonBlockingUnknowns
    };
    assertPublicValue(publicRecord);
    const termsHash = hashTerms(publicRecord);
    const status = evaluation.status === "clarifying" ? "clarifying" : "terms_ready";
    const at = evaluation.evaluatedAt || clock.nowIso();

    return database.transaction(() => {
      let existing = statements.byPair.get(renterTask.id, supplyTask.id);
      let created = false;
      if (!existing) {
        const id = randomUUID();
        created = statements.insert.run(
          id,
          renterTask.id,
          supplyTask.id,
          status,
          evaluation.renterInputVersion,
          evaluation.supplyInputVersion,
          expiresAt,
          at,
          at
        ).changes > 0;
        existing = statements.byPair.get(renterTask.id, supplyTask.id);
      }

      let terms = statements.termsByHash.get(existing.id, termsHash);
      let termsCreated = false;
      if (!terms) {
        const version = Number(statements.latestTermsVersion.get(existing.id).version) + 1;
        statements.insertTerms.run(
          existing.id,
          version,
          termsHash,
          stableJson(publicRecord.publicTerms),
          stableJson(publicRecord.blockingUnknowns),
          stableJson(publicRecord.nonBlockingUnknowns),
          at
        );
        terms = statements.termsByVersion.get(existing.id, version);
        termsCreated = true;
      } else {
        statements.reactivateTerms.run(existing.id, terms.version);
      }
      statements.invalidateOtherTerms.run(at, existing.id, terms.version);

      const stateChanged = created || termsCreated || existing.status !== status
        || Number(existing.renter_input_version) !== evaluation.renterInputVersion
        || Number(existing.supply_input_version) !== evaluation.supplyInputVersion
        || Number(existing.current_terms_version || 0) !== Number(terms.version);
      statements.update.run(
        status,
        evaluation.renterInputVersion,
        evaluation.supplyInputVersion,
        terms.version,
        expiresAt,
        at,
        existing.id
      );
      if (created) statements.insertEvent.run(existing.id, "case_created", stableJson({ status }), at);
      else if (stateChanged) statements.insertEvent.run(existing.id, "case_recalculated", stableJson({ status, termsVersion: Number(terms.version) }), at);
      return hydrate(statements.byId.get(existing.id));
    });
  }

  function invalidate(caseId, reason, status = "invalidated", at = clock.nowIso()) {
    return database.transaction(() => {
      const before = statements.byId.get(caseId);
      if (!before) return null;
      const changed = statements.invalidate.run(status, reason, at, caseId).changes > 0;
      if (changed && before.status !== status) statements.insertEvent.run(caseId, `case_${status}`, stableJson({ reason }), at);
      return hydrate(statements.byId.get(caseId));
    });
  }

  function syncClarifications(matchCaseId, questions, at = clock.nowIso()) {
    return database.transaction(() => {
      const desired = new Set(questions.map((question) => `${question.targetParty}\u0000${question.fieldKey}`));
      const existing = statements.clarifications.all(matchCaseId).map(clarificationFromRow);
      for (const item of existing) {
        if (item.status === "open" && !desired.has(`${item.targetParty}\u0000${item.fieldKey}`)) {
          statements.supersedeClarification.run(item.id);
        }
      }
      const matchCase = statements.byId.get(matchCaseId);
      for (const question of questions) {
        if (statements.answeredField.get(matchCaseId, question.targetParty, question.fieldKey)) continue;
        const answerSpecJson = stableJson({ ...question.answerSpec, provider: question.provider || "rule_template" });
        const updated = statements.updateOpenClarification.run(
          matchCase.current_terms_version,
          question.question,
          question.reasonCode,
          question.priority,
          answerSpecJson,
          matchCaseId,
          question.targetParty,
          question.fieldKey
        );
        if (updated.changes) continue;
        statements.insertClarification.run(
          randomUUID(),
          matchCaseId,
          matchCase.current_terms_version,
          question.targetParty,
          question.fieldKey,
          question.question,
          question.reasonCode,
          question.priority,
          answerSpecJson,
          at
        );
      }
      return statements.clarifications.all(matchCaseId).map(clarificationFromRow);
    });
  }

  function markClarificationAnswered(id, matchCaseId, rawAnswer, structuredAnswer, at = clock.nowIso()) {
    const result = statements.answerClarification.run(String(rawAnswer), stableJson(structuredAnswer), at, id);
    if (result.changes) statements.insertEvent.run(matchCaseId, "clarification_answered", stableJson({ clarificationId: id }), at);
    return clarificationFromRow(statements.clarificationById.get(id, matchCaseId));
  }

  return {
    upsertEvaluation,
    invalidate,
    invalidateForTask(taskId, reason, status = "invalidated", at = clock.nowIso()) {
      return statements.casesForTask.all(taskId, taskId).map((row) => invalidate(row.id, reason, status, at));
    },
    findByPair: (renterTaskId, supplyTaskId) => hydrate(statements.byPair.get(renterTaskId, supplyTaskId)),
    listForTask: (taskId) => statements.casesForTask.all(taskId, taskId).map(hydrate),
    participantParty(caseId, ownerId) {
      return statements.participant.get(ownerId, ownerId, caseId, ownerId, ownerId)?.party || null;
    },
    syncClarifications,
    listClarifications: (caseId) => statements.clarifications.all(caseId).map(clarificationFromRow),
    getClarification: (id, caseId) => clarificationFromRow(statements.clarificationById.get(id, caseId)),
    getClarificationForOwner: (id, caseId, ownerId) => clarificationFromRow(statements.clarificationForOwner.get(id, caseId, ownerId, ownerId)),
    markClarificationAnswered,
    get: (id) => hydrate(statements.byId.get(id)),
    getForOwner: (id, ownerId) => hydrate(statements.forOwner.get(id, ownerId, ownerId)),
    list: () => statements.all.all().map(hydrate),
    listEvents: (caseId) => statements.events.all(caseId).map((row) => ({
      id: row.id,
      type: row.type,
      payload: parseJsonStrict(row.payload_json, `match event ${row.id}`),
      createdAt: row.created_at
    })),
    transaction: database.transaction
  };
}
