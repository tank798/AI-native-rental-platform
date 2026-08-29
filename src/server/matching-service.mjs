import { marketplaceListings, marketplaceTenants } from "../marketplace-corpus.mjs";
import {
  listingFromSupplyDraft,
  matchMandate,
  matchSupplyDraft
} from "../simulation-engine.mjs";

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
    listing
  };
}

function publicTenant(candidate) {
  const tenant = candidate.tenant;
  return {
    ...candidate,
    displayAlias: candidate.displayAlias || tenant.alias,
    tenant: {
      id: tenant.id,
      alias: tenant.alias,
      occupation: tenant.occupation,
      mandate: {
        leaseMonths: tenant.mandate.leaseMonths,
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

export function createMatchingService(repository) {
  function renterPool(task) {
    const userListings = repository.listOppositeTasks("renter", task.ownerId).map((supplyTask, index) => {
      const listing = listingFromSupplyDraft(supplyTask.payload.draft, task.payload.mandate, index);
      return {
        ...listing,
        id: `task-listing-${supplyTask.id}`,
        shortTitle: supplyTask.payload.draft.title || `${supplyTask.payload.draft.location}个人房源`,
        title: supplyTask.payload.draft.title || `${supplyTask.payload.draft.location}个人房源`,
        __taskId: supplyTask.id,
        __ownerId: supplyTask.ownerId
      };
    });
    return [...marketplaceListings, ...userListings];
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
    return [...marketplaceTenants, ...userTenants];
  }

  function processRenter(task) {
    const pool = renterPool(task);
    const result = matchMandate(task.payload.mandate, pool, { startedAt: new Date().toISOString() });
    const candidates = result.candidates.map((candidate) => ({
      counterpartyId: candidateCounterparty(candidate, "seed-listing"),
      payload: publicListing(candidate)
    }));
    repository.replaceCandidates(task.id, candidates, pool.length);
    return repository.getTask(task.id);
  }

  function processSupply(task) {
    const pool = supplyPool(task);
    const result = matchSupplyDraft(task.payload.draft, pool);
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
    if (!task || task.status !== "active") return task;
    return task.kind === "renter" ? processRenter(task) : processSupply(task);
  }

  function processAfterTaskCreated(taskId) {
    repository.expireDueTasks();
    const createdTask = repository.getTask(taskId);
    if (!createdTask) return null;
    processTask(taskId);
    const oppositeKind = createdTask.kind === "renter" ? "supply" : "renter";
    repository.listActiveTasks(oppositeKind)
      .filter((task) => task.ownerId !== createdTask.ownerId)
      .forEach((task) => processTask(task.id));
    return repository.getTask(taskId);
  }

  function processAllActive() {
    repository.expireDueTasks();
    const tasks = repository.listActiveTasks();
    tasks.forEach((task) => processTask(task.id));
    return tasks.length;
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
    processTask,
    processAfterTaskCreated,
    processAllActive,
    expireDueTasks: repository.expireDueTasks,
    snapshot
  };
}
