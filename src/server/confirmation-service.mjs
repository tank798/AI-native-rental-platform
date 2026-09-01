import { createClock } from "../clock.mjs";

function serviceError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function activeDecisions(matchCaseRepository, matchCase) {
  return matchCaseRepository.listConfirmations(matchCase.id)
    .filter((item) => !item.revokedAt)
    .filter((item) => item.termsVersion === matchCase.terms.version && item.termsHash === matchCase.terms.hash)
    .filter((item) => item.renterInputVersion === matchCase.renterInputVersion)
    .filter((item) => item.supplyInputVersion === matchCase.supplyInputVersion);
}

function decisionFor(items, party) {
  return items.find((item) => item.party === party)?.decision || "pending";
}

/** Enforces same-document, same-input bilateral consent for one match case. */
export function createConfirmationService({ matchCaseRepository, contactService, contactGrantService, eventService = null, clock = createClock() }) {
  if (!matchCaseRepository) throw new Error("confirmation service requires matchCaseRepository");
  if (!contactService || !contactGrantService) throw new Error("confirmation service requires contact services");

  function context(matchCaseId, ownerId) {
    const matchCase = matchCaseRepository.getForOwner(matchCaseId, ownerId);
    const participant = matchCaseRepository.participant(matchCaseId, ownerId);
    if (!matchCase || !participant) throw serviceError(404, "MATCH_CASE_NOT_FOUND", "匹配案例不存在");
    return { matchCase, participant };
  }

  function assertCurrent(matchCase, termsVersion, termsHash) {
    if (!matchCase.terms || matchCase.currentTermsVersion !== Number(termsVersion) || matchCase.terms.hash !== termsHash) {
      throw serviceError(409, "TERMS_VERSION_STALE", "条款已经变化，请刷新后重新确认");
    }
  }

  function snapshot(matchCase, party, idempotent = false) {
    const decisions = activeDecisions(matchCaseRepository, matchCase);
    const otherParty = party === "renter" ? "supply" : "renter";
    return {
      matchCase,
      myDecision: decisionFor(decisions, party),
      otherDecision: decisionFor(decisions, otherParty),
      idempotent
    };
  }

  function decide({ matchCaseId, ownerId, termsVersion, termsHash, decision }) {
    const { matchCase, participant } = context(matchCaseId, ownerId);
    assertCurrent(matchCase, termsVersion, termsHash);
    contactGrantService.assertCaseActive(matchCaseId);
    if (decision === "confirmed") contactGrantService.assertOwnerHasContact(ownerId);
    const current = activeDecisions(matchCaseRepository, matchCase);
    const mine = current.find((item) => item.party === participant.party);

    if (mine?.decision === decision) {
      if (decision === "confirmed" && matchCase.status === "mutually_confirmed") {
        return matchCaseRepository.transaction(() => {
          contactGrantService.issue(matchCaseId, clock.nowIso());
          return snapshot(matchCaseRepository.get(matchCaseId), participant.party, true);
        });
      }
      return snapshot(matchCase, participant.party, true);
    }
    if (mine?.decision === "declined" && decision === "confirmed") {
      throw serviceError(409, "MATCH_ALREADY_DECLINED", "你已经拒绝当前条款");
    }
    if (["declined", "invalidated", "expired", "closed"].includes(matchCase.status)) {
      throw serviceError(409, "MATCH_NOT_CONFIRMABLE", "当前匹配已经不能确认");
    }
    if (!["terms_ready", "awaiting_confirmations", "mutually_confirmed"].includes(matchCase.status)) {
      throw serviceError(409, "MATCH_NOT_CONFIRMABLE", "当前条款尚未准备好");
    }
    if (matchCase.status === "mutually_confirmed" && decision !== "declined") {
      return snapshot(matchCase, participant.party, true);
    }

    const at = clock.nowIso();
    return matchCaseRepository.transaction(() => {
      matchCaseRepository.recordDecision({
        matchCaseId,
        party: participant.party,
        ownerId,
        termsVersion: matchCase.terms.version,
        termsHash: matchCase.terms.hash,
        renterInputVersion: matchCase.renterInputVersion,
        supplyInputVersion: matchCase.supplyInputVersion,
        decision,
        at
      });
      eventService?.record({
        type: "confirmation.recorded",
        aggregateId: matchCaseId,
        actorOwnerId: ownerId,
        payload: {
          party: participant.party,
          termsVersion: matchCase.terms.version,
          latencyMs: Math.max(0, Date.parse(at) - Date.parse(matchCase.createdAt))
        },
        dedupeKey: `confirmation:${matchCaseId}:${participant.party}:${matchCase.terms.version}`,
        createdAt: at
      });
      const afterDecision = matchCaseRepository.get(matchCaseId);
      const decisions = activeDecisions(matchCaseRepository, afterDecision);
      let status;
      let terminalReason = null;
      if (decisions.some((item) => item.decision === "declined")) {
        status = "declined";
        terminalReason = "party_declined";
      } else if (["renter", "supply"].every((party) => decisionFor(decisions, party) === "confirmed")) {
        status = "mutually_confirmed";
      } else {
        status = "awaiting_confirmations";
      }
      const updated = matchCaseRepository.setCaseStatus(matchCaseId, status, terminalReason, at);
      if (status === "mutually_confirmed") contactGrantService.issue(matchCaseId, at);
      if (status === "declined") contactGrantService.revokeForCase(matchCaseId, "party_declined", at);
      return snapshot(updated, participant.party, false);
    });
  }

  return {
    status(matchCaseId, ownerId) {
      const { matchCase, participant } = context(matchCaseId, ownerId);
      return snapshot(matchCase, participant.party);
    },
    confirm(input) {
      return decide({ ...input, decision: "confirmed" });
    },
    decline(input) {
      return decide({ ...input, decision: "declined" });
    }
  };
}
