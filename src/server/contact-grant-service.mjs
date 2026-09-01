import { randomUUID } from "node:crypto";
import { createClock, isoTimestampFromMilliseconds } from "../clock.mjs";

const DEFAULT_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function serviceError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function safeJson(value) {
  return JSON.stringify(value || {});
}

function activeConfirmations(matchCaseRepository, matchCase) {
  return matchCaseRepository.listConfirmations(matchCase.id)
    .filter((item) => !item.revokedAt && item.decision === "confirmed")
    .filter((item) => item.termsVersion === matchCase.terms?.version && item.termsHash === matchCase.terms?.hash)
    .filter((item) => item.renterInputVersion === matchCase.renterInputVersion)
    .filter((item) => item.supplyInputVersion === matchCase.supplyInputVersion);
}

/** Issues and revalidates the narrow capability used to read a counterparty contact. */
export function createContactGrantService({
  database,
  matchCaseRepository,
  contactService,
  eventService = null,
  clock = createClock(),
  ttlMs = DEFAULT_GRANT_TTL_MS
}) {
  if (!database?.raw || !database?.transaction) throw new Error("contact grant service requires an open rental database");
  if (!matchCaseRepository || !contactService) throw new Error("contact grant service requires case and contact services");
  const db = database.raw;
  const statements = {
    context: db.prepare(`
      SELECT cases.id, cases.status, cases.renter_input_version, cases.supply_input_version,
             cases.current_terms_version, cases.expires_at AS case_expires_at,
             terms.terms_hash,
             renter.owner_id AS renter_owner_id, renter.status AS renter_status, renter.expires_at AS renter_expires_at,
             supply.owner_id AS supply_owner_id, supply.status AS supply_status, supply.expires_at AS supply_expires_at
      FROM match_cases AS cases
      JOIN tasks AS renter ON renter.id = cases.renter_task_id
      JOIN tasks AS supply ON supply.id = cases.supply_task_id
      LEFT JOIN match_terms AS terms
        ON terms.match_case_id = cases.id AND terms.version = cases.current_terms_version
      WHERE cases.id = ?
    `),
    active: db.prepare("SELECT * FROM contact_grants WHERE match_case_id = ? AND revoked_at IS NULL ORDER BY granted_at DESC LIMIT 1"),
    insert: db.prepare(`
      INSERT INTO contact_grants(id, match_case_id, terms_version, terms_hash, renter_input_version,
                                 supply_input_version, renter_owner_id, supply_owner_id, granted_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    revoke: db.prepare(`
      UPDATE contact_grants SET revoked_at = ?, revoke_reason = ?
      WHERE match_case_id = ? AND revoked_at IS NULL
    `),
    expired: db.prepare("SELECT match_case_id FROM contact_grants WHERE revoked_at IS NULL AND expires_at <= ?"),
    history: db.prepare("SELECT * FROM contact_grants WHERE match_case_id = ? ORDER BY granted_at ASC"),
    insertEvent: db.prepare("INSERT INTO match_events(match_case_id, actor_owner_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
  };

  function participant(matchCaseId, ownerId) {
    const item = matchCaseRepository.participant(matchCaseId, ownerId);
    if (!item) throw serviceError(404, "MATCH_CASE_NOT_FOUND", "匹配案例不存在");
    return item;
  }

  function currentContext(matchCaseId) {
    return statements.context.get(matchCaseId) || null;
  }

  function stateReason(context, grant, at) {
    if (!context) return "case_missing";
    if (context.renter_status !== "active") return `task_${context.renter_status}`;
    if (context.supply_status !== "active") return `task_${context.supply_status}`;
    if (context.renter_expires_at <= at || context.supply_expires_at <= at) return "task_expired";
    if (context.case_expires_at <= at) return "case_expired";
    if (context.status !== "mutually_confirmed") return `case_${context.status}`;
    if (!grant) return "grant_missing";
    if (grant.expires_at <= at) return "grant_expired";
    if (Number(grant.terms_version) !== Number(context.current_terms_version) || grant.terms_hash !== context.terms_hash) return "terms_changed";
    if (Number(grant.renter_input_version) !== Number(context.renter_input_version)
      || Number(grant.supply_input_version) !== Number(context.supply_input_version)) return "task_input_changed";
    if (grant.renter_owner_id !== context.renter_owner_id || grant.supply_owner_id !== context.supply_owner_id) return "participants_changed";
    const matchCase = matchCaseRepository.get(context.id);
    const confirmed = matchCase?.terms ? activeConfirmations(matchCaseRepository, matchCase) : [];
    if (!["renter", "supply"].every((party) => confirmed.some((item) => item.party === party))) return "confirmation_revoked";
    return null;
  }

  function revokeForCase(matchCaseId, reason, at = clock.nowIso()) {
    return database.transaction(() => {
      const active = statements.active.get(matchCaseId);
      if (!active) return false;
      const changed = statements.revoke.run(at, reason, matchCaseId).changes > 0;
      if (changed) {
        statements.insertEvent.run(
          matchCaseId,
          null,
          "contact.revoked",
          safeJson({ grantId: active.id, reason, termsVersion: Number(active.terms_version) }),
          at
        );
        eventService?.record({
          type: "contact.revoked",
          aggregateId: matchCaseId,
          payload: { reason, termsVersion: Number(active.terms_version) },
          dedupeKey: `contact-revoked:${active.id}`,
          createdAt: at
        });
      }
      return changed;
    });
  }

  function assertContacts(context) {
    if (!contactService.has(context.renter_owner_id) || !contactService.has(context.supply_owner_id)) {
      throw serviceError(422, "CONTACT_REQUIRED", "双方需要先设置可用联系方式");
    }
  }

  function assertCaseActive(context, at = clock.nowIso()) {
    if (!context
      || context.renter_status !== "active"
      || context.supply_status !== "active"
      || context.renter_expires_at <= at
      || context.supply_expires_at <= at
      || context.case_expires_at <= at) {
      throw serviceError(409, "MATCH_NOT_CONFIRMABLE", "当前匹配任务已经失效");
    }
  }

  function issue(matchCaseId, at = clock.nowIso()) {
    return database.transaction(() => {
      const context = currentContext(matchCaseId);
      if (!context) throw serviceError(404, "MATCH_CASE_NOT_FOUND", "匹配案例不存在");
      assertCaseActive(context, at);
      assertContacts(context);
      const current = statements.active.get(matchCaseId);
      const currentReason = stateReason(context, current, at);
      if (current && !currentReason) return { id: current.id, idempotent: true };
      if (current) revokeForCase(matchCaseId, currentReason || "superseded", at);

      const matchCase = matchCaseRepository.get(matchCaseId);
      if (!matchCase?.terms || matchCase.status !== "mutually_confirmed") {
        throw serviceError(409, "MATCH_NOT_CONFIRMABLE", "当前匹配尚未完成双方确认");
      }
      const confirmed = activeConfirmations(matchCaseRepository, matchCase);
      if (!["renter", "supply"].every((party) => confirmed.some((item) => item.party === party))) {
        throw serviceError(409, "MATCH_NOT_CONFIRMABLE", "双方确认状态已经变化");
      }
      const id = randomUUID();
      const ttlExpiry = isoTimestampFromMilliseconds(clock.now().getTime() + ttlMs);
      const expiresAt = [ttlExpiry, context.case_expires_at, context.renter_expires_at, context.supply_expires_at].sort()[0];
      statements.insert.run(
        id,
        matchCaseId,
        matchCase.terms.version,
        matchCase.terms.hash,
        matchCase.renterInputVersion,
        matchCase.supplyInputVersion,
        context.renter_owner_id,
        context.supply_owner_id,
        at,
        expiresAt
      );
      statements.insertEvent.run(
        matchCaseId,
        null,
        "contact.granted",
        safeJson({ grantId: id, termsVersion: matchCase.terms.version, expiresAt }),
        at
      );
      eventService?.record({
        type: "contact.unlocked",
        aggregateId: matchCaseId,
        payload: { termsVersion: matchCase.terms.version },
        dedupeKey: `contact-unlocked:${id}`,
        createdAt: at
      });
      return { id, idempotent: false, expiresAt };
    });
  }

  function isUnlocked(matchCaseId, ownerId) {
    if (!matchCaseRepository.participant(matchCaseId, ownerId)) return false;
    const at = clock.nowIso();
    const context = currentContext(matchCaseId);
    const grant = statements.active.get(matchCaseId);
    return Boolean(grant && !stateReason(context, grant, at));
  }

  function getForOwner(matchCaseId, ownerId) {
    const owner = participant(matchCaseId, ownerId);
    const at = clock.nowIso();
    const context = currentContext(matchCaseId);
    const grant = statements.active.get(matchCaseId);
    const reason = stateReason(context, grant, at);
    if (!grant || reason) {
      if (grant) revokeForCase(matchCaseId, reason || "invalid", at);
      throw serviceError(403, "CONTACT_LOCKED", "双方确认同一版条件后才能交换联系方式");
    }
    const targetOwnerId = owner.party === "renter" ? owner.supplyOwnerId : owner.renterOwnerId;
    const contact = contactService.reveal(targetOwnerId);
    if (!contact) {
      revokeForCase(matchCaseId, "contact_missing", at);
      throw serviceError(403, "CONTACT_LOCKED", "对方联系方式当前不可用");
    }
    statements.insertEvent.run(
      matchCaseId,
      ownerId,
      "contact.viewed",
      safeJson({ grantId: grant.id, viewerParty: owner.party, termsVersion: Number(grant.terms_version) }),
      at
    );
    eventService?.record({
      type: "contact.viewed",
      aggregateId: matchCaseId,
      actorOwnerId: ownerId,
      payload: { party: owner.party, termsVersion: Number(grant.terms_version) },
      dedupeKey: `contact-viewed:${grant.id}:${ownerId}`,
      createdAt: at
    });
    return { contact, grantExpiresAt: grant.expires_at };
  }

  return {
    issue,
    isUnlocked,
    getForOwner,
    revokeForCase,
    cleanupExpired(at = clock.nowIso()) {
      const rows = statements.expired.all(at);
      let revoked = 0;
      for (const row of rows) revoked += revokeForCase(row.match_case_id, "grant_expired", at) ? 1 : 0;
      return revoked;
    },
    assertOwnerHasContact(ownerId) {
      if (!contactService.has(ownerId)) throw serviceError(422, "CONTACT_REQUIRED", "请先设置可用联系方式");
      return true;
    },
    assertParticipantsHaveContacts(matchCaseId) {
      const context = currentContext(matchCaseId);
      if (!context) throw serviceError(404, "MATCH_CASE_NOT_FOUND", "匹配案例不存在");
      assertContacts(context);
      return true;
    },
    assertCaseActive(matchCaseId, at = clock.nowIso()) {
      const context = currentContext(matchCaseId);
      if (!context) throw serviceError(404, "MATCH_CASE_NOT_FOUND", "匹配案例不存在");
      assertCaseActive(context, at);
      return true;
    },
    listForCase: (matchCaseId) => statements.history.all(matchCaseId)
  };
}
