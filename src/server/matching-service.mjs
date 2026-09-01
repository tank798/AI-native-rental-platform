import { marketplaceListings, marketplaceTenants } from "../marketplace-corpus.mjs";
import {
  listingFromSupplyDraft,
  matchMandate,
  matchSupplyDraft
} from "../simulation-engine.mjs";
import { createClock } from "../clock.mjs";
import { createClarificationService } from "./clarification-service.mjs";
import { createConfirmationService } from "./confirmation-service.mjs";
import { createContactGrantService } from "./contact-grant-service.mjs";
import { createContactService } from "./contact-service.mjs";
import { createMatchCaseRepository } from "./match-case-repository.mjs";
import { createMatchCaseService } from "./match-case-service.mjs";
import { PAIR_EVALUATOR_VERSION } from "./pair-evaluator.mjs";
import { createTaskRepository } from "./task-repository.mjs";
import { normalizeMarketMode } from "./runtime-config.mjs";

function renterLabel(task) {
  return `租客 ${task.id.slice(0, 6)}`;
}

function publicListing(candidate) {
  const listing = { ...candidate.listing };
  const isUserListing = Boolean(listing.__taskId);
  delete listing.minRent;
  delete listing.conditionalOffers;
  delete listing.__taskId;
  delete listing.__ownerId;
  listing.addressHint = isUserListing
    ? `${listing.district || ""}${listing.location || ""} · 精确地址待双方确认`
    : listing.addressHint;

  return {
    ...candidate,
    counterpartyType: isUserListing ? "task" : "fixture",
    listing
  };
}

function publicTenant(candidate) {
  const tenant = candidate.tenant;
  const isUserTenant = Boolean(tenant.__taskId);
  return {
    ...candidate,
    counterpartyType: isUserTenant ? "task" : "fixture",
    displayAlias: candidate.displayAlias || tenant.alias,
    tenant: {
      id: tenant.id,
      alias: tenant.alias,
      occupation: tenant.occupation,
      mandate: {
        leaseMonths: tenant.mandate.leaseMonths,
        leaseFlexible: Boolean(tenant.mandate.leaseFlexible),
        leaseMonthsRange: tenant.mandate.leaseMonthsRange || null,
        moveInWindow: tenant.mandate.moveInWindow,
        sharedHousing: tenant.mandate.sharedHousing,
        roommateGender: tenant.mandate.roommateGender,
        maxCommuteMinutes: tenant.mandate.maxCommuteMinutes
      }
    }
  };
}

function candidateCounterparty(candidate, fallbackPrefix) {
  if (candidate.listing) return candidate.listing.__taskId || `${fallbackPrefix}:${candidate.listing.id}`;
  return candidate.tenant.__taskId || `${fallbackPrefix}:${candidate.tenant.id}`;
}

/**
 * Creates the synchronous matching facade for the selected market mode.
 * Real mode only compares persisted tasks; demo mode additionally scans the
 * fixture corpus so product demonstrations remain available and explicit.
 */
export function createMatchingService(repository, {
  marketMode = "real",
  clock = createClock(),
  contactEncryptionKey = null,
  onContactSecurityError = () => {},
  mediaRepository = null,
  eventService = null
} = {}) {
  const normalizedMarketMode = normalizeMarketMode(marketMode);
  const effectiveContactKey = contactEncryptionKey || (normalizedMarketMode === "demo" ? Buffer.alloc(32, 0x44).toString("base64") : null);
  const taskRepository = createTaskRepository({ database: repository, clock });
  const matchCaseRepository = createMatchCaseRepository({ database: repository, clock });
  const contacts = createContactService({
    database: repository,
    encryptionKey: effectiveContactKey,
    clock,
    onSecurityError: onContactSecurityError
  });
  const contactGrants = createContactGrantService({
    database: repository,
    matchCaseRepository,
    contactService: contacts,
    clock,
    eventService
  });
  const clarifications = createClarificationService({
    taskRepository,
    matchCaseRepository,
    clock,
    recalculate: (taskId) => processTask(taskId)
  });
  const confirmations = createConfirmationService({
    matchCaseRepository,
    contactService: contacts,
    contactGrantService: contactGrants,
    clock,
    eventService
  });
  const matchCases = createMatchCaseService({
    taskRepository,
    matchCaseRepository,
    mediaRepository,
    clock,
    onCaseEvaluated: (context) => {
      clarifications.syncForCase(context);
      if (!eventService || !context.matchCase || !context.renterTask || !context.supplyTask || context.evaluation?.status === "hard_conflict") return;
      const { matchCase, renterTask, supplyTask } = context;
      for (const task of [renterTask, supplyTask]) {
        eventService.record({
          type: "candidate.created",
          aggregateId: task.id,
          payload: {
            candidateCount: 1,
            latencyMs: Math.max(0, Date.parse(matchCase.createdAt) - Date.parse(task.createdAt))
          },
          dedupeKey: `candidate:${task.id}:${matchCase.id}`,
          createdAt: matchCase.createdAt
        });
      }
      if (matchCase.status === "clarifying") {
        for (const party of ["renter", "supply"]) {
          const questionCount = matchCaseRepository.listClarifications(matchCase.id)
            .filter((item) => item.status === "open" && item.targetParty === party).length;
          if (!questionCount) continue;
          eventService.record({
            type: "clarification.requested",
            aggregateId: matchCase.id,
            payload: { party, questionCount, termsVersion: Number(matchCase.currentTermsVersion || 0) },
            dedupeKey: `clarification:${matchCase.id}:${party}:${matchCase.currentTermsVersion || 0}`
          });
        }
      }
      if (matchCase.terms && ["terms_ready", "awaiting_confirmations", "mutually_confirmed"].includes(matchCase.status)) {
        eventService.record({
          type: "terms.ready",
          aggregateId: matchCase.id,
          payload: {
            termsVersion: matchCase.terms.version,
            latencyMs: Math.max(0, Date.parse(matchCase.updatedAt) - Date.parse(matchCase.createdAt))
          },
          dedupeKey: `terms-ready:${matchCase.id}:${matchCase.terms.version}`,
          createdAt: matchCase.updatedAt
        });
      }
    }
  });

  function renterPool(task) {
    const userListings = repository.listOppositeTasks("renter", task.ownerId).map((supplyTask, index) => {
      const listing = listingFromSupplyDraft(supplyTask.payload.draft, task.payload.mandate, index);
      return {
        ...listing,
        id: `task-listing-${supplyTask.id}`,
        shortTitle: supplyTask.payload.draft.title || `${supplyTask.payload.draft.location}个人房源`,
        title: supplyTask.payload.draft.title || `${supplyTask.payload.draft.location}个人房源`,
        photos: mediaRepository?.listPublicForTask(supplyTask.id) || [],
        __taskId: supplyTask.id,
        __ownerId: supplyTask.ownerId
      };
    });
    return normalizedMarketMode === "demo"
      ? [...marketplaceListings, ...userListings]
      : userListings;
  }

  function supplyPool(task) {
    const userTenants = repository.listOppositeTasks("supply", task.ownerId).map((renterTask) => ({
      id: `task-tenant-${renterTask.id}`,
      alias: renterLabel(renterTask),
      occupation: "平台实名租客",
      mandate: renterTask.payload.mandate,
      __taskId: renterTask.id,
      __ownerId: renterTask.ownerId
    }));
    return normalizedMarketMode === "demo"
      ? [...marketplaceTenants, ...userTenants]
      : userTenants;
  }

  function processRenter(task) {
    const pool = renterPool(task);
    const result = matchMandate(task.payload.mandate, pool, { clock });
    const candidates = result.candidates.map((candidate) => ({
      counterpartyId: candidateCounterparty(candidate, "seed-listing"),
      payload: publicListing(candidate)
    }));
    repository.replaceCandidates(task.id, candidates, pool.length);
    return repository.getTask(task.id);
  }

  function processSupply(task) {
    const pool = supplyPool(task);
    const result = matchSupplyDraft(task.payload.draft, pool, { clock });
    const counts = new Map();
    result.candidates.forEach((candidate) => {
      counts.set(candidate.tenant.alias, (counts.get(candidate.tenant.alias) || 0) + 1);
    });
    const candidates = result.candidates.map((candidate) => {
      const suffix = String(candidate.tenant.id).slice(-3).toUpperCase();
      const displayAlias = counts.get(candidate.tenant.alias) > 1 ? `${candidate.tenant.alias} · ${suffix}` : candidate.tenant.alias;
      return {
        counterpartyId: candidateCounterparty(candidate, "seed-tenant"),
        payload: publicTenant({ ...candidate, displayAlias })
      };
    });
    repository.replaceCandidates(task.id, candidates, pool.length);
    return repository.getTask(task.id);
  }

  function processTask(taskId) {
    const task = repository.getTask(taskId);
    if (!task) return task;
    if (normalizedMarketMode === "real") {
      matchCases.processTask(taskId);
      return repository.getTask(taskId);
    }
    matchCases.processTask(taskId);
    if (task.status !== "active") return repository.getTask(taskId);
    return task.kind === "renter" ? processRenter(task) : processSupply(task);
  }

  function processAfterTaskCreated(taskId) {
    repository.expireDueTasks();
    const createdTask = repository.getTask(taskId);
    if (!createdTask) return null;
    if (normalizedMarketMode === "real") {
      matchCases.processTask(taskId);
      return repository.getTask(taskId);
    }
    processTask(taskId);
    const oppositeKind = createdTask.kind === "renter" ? "supply" : "renter";
    repository.listActiveTasks(oppositeKind)
      .filter((task) => task.ownerId !== createdTask.ownerId)
      .forEach((task) => processTask(task.id));
    return repository.getTask(taskId);
  }

  function processAllActive() {
    repository.expireDueTasks();
    if (normalizedMarketMode === "real") {
      return matchCases.processAllActive().taskCount;
    }
    matchCases.processAllActive();
    const tasks = repository.listActiveTasks();
    tasks.forEach((task) => processTask(task.id));
    return tasks.length;
  }

  function processOutboxEvent(event, jobRepository) {
    const taskId = event?.payload?.taskId || event?.aggregateId;
    const task = taskRepository.get(taskId);
    if (!task) return { missingTask: true, evaluatedPairs: 0, skippedPairs: 0, staleResultDiscards: 0 };
    if (event?.payload?.inputVersion && Number(event.payload.inputVersion) !== task.inputVersion) {
      return { staleEvent: true, evaluatedPairs: 0, skippedPairs: 0, staleResultDiscards: 1 };
    }
    if (normalizedMarketMode === "demo") {
      processTask(task.id);
      if (task.status === "active") {
        const oppositeKind = task.kind === "renter" ? "supply" : "renter";
        repository.listActiveTasks(oppositeKind)
          .filter((opposite) => opposite.ownerId !== task.ownerId)
          .forEach((opposite) => processTask(opposite.id));
      }
      return { evaluatedPairs: 0, skippedPairs: 0, staleResultDiscards: 0, demo: true };
    }
    if (task.status !== "active") {
      const invalidated = matchCases.processTask(task.id, { opposites: [] });
      return { ...invalidated, staleResultDiscards: 0 };
    }

    const opposites = taskRepository.listAffectedOpposites(task);
    const result = matchCases.processTask(task.id, {
      opposites,
      beforePair({ task: currentTask, opposite }) {
        const renterTask = currentTask.kind === "renter" ? currentTask : opposite;
        const supplyTask = currentTask.kind === "supply" ? currentTask : opposite;
        const jobKey = [
          "pair",
          renterTask.id,
          renterTask.inputVersion,
          supplyTask.id,
          supplyTask.inputVersion,
          PAIR_EVALUATOR_VERSION
        ].join(":");
        const job = jobRepository.beginMatchJob({
          jobKey,
          eventId: event.id,
          renterTaskId: renterTask.id,
          renterInputVersion: renterTask.inputVersion,
          supplyTaskId: supplyTask.id,
          supplyInputVersion: supplyTask.inputVersion,
          evaluatorVersion: PAIR_EVALUATOR_VERSION
        });
        return { ...job, jobKey, skip: !job.shouldProcess };
      },
      afterPair({ job, processed, durationMs }) {
        if (processed.stale) jobRepository.markMatchJobStale(job.jobKey, "task_version_changed", durationMs);
        else jobRepository.completeMatchJob(job.jobKey, durationMs);
      }
    });
    return { ...result, staleResultDiscards: result.stalePairs || 0 };
  }

  function snapshot(taskId) {
    const task = repository.getTask(taskId);
    if (!task) return null;
    return {
      task,
      candidates: repository.listCandidates(taskId).map((candidate) => candidate.payload),
      events: repository.listEvents(taskId)
    };
  }

  return {
    marketMode: normalizedMarketMode,
    matchCases,
    clarifications,
    confirmations,
    contacts,
    contactGrants,
    matchCaseRepository,
    taskRepository,
    processTask,
    processAfterTaskCreated,
    processAllActive,
    processOutboxEvent,
    expireDueTasks: repository.expireDueTasks,
    snapshot
  };
}
