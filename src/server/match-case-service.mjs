import { createClock } from "../clock.mjs";
import { evaluateTaskPair } from "./pair-evaluator.mjs";

function pairTasks(left, right) {
  return left.kind === "renter"
    ? { renterTask: left, supplyTask: right }
    : { renterTask: right, supplyTask: left };
}

function counterpartId(matchCase, taskId) {
  return matchCase.renterTaskId === taskId ? matchCase.supplyTaskId : matchCase.renterTaskId;
}

/** Coordinates one symmetric write for case state and both candidate views. */
export function createMatchCaseService({ taskRepository, matchCaseRepository, clock = createClock(), onCaseEvaluated = null }) {
  if (!taskRepository || !matchCaseRepository) throw new Error("match case service requires task and case repositories");

  function projectionForRenter(evaluation, matchCase, supplyTask) {
    return {
      ...evaluation.renterCandidateProjection,
      matchCaseId: matchCase.id,
      selectionLabel: evaluation.status === "clarifying" ? "条件待确认" : "条件匹配",
      listing: {
        ...evaluation.renterCandidateProjection.listing,
        id: `task-listing-${supplyTask.id}`
      }
    };
  }

  function projectionForSupply(evaluation, matchCase, renterTask) {
    return {
      ...evaluation.supplyCandidateProjection,
      matchCaseId: matchCase.id,
      selectionLabel: evaluation.status === "clarifying" ? "条件待确认" : "条件匹配",
      tenant: {
        ...evaluation.supplyCandidateProjection.tenant,
        id: `task-tenant-${renterTask.id}`
      }
    };
  }

  function processPair(left, right, evaluatedAt = clock.nowIso()) {
    if (!left || !right || left.__fixture || right.__fixture || left.counterpartyType === "fixture" || right.counterpartyType === "fixture") {
      return { matchCase: null, evaluation: null, changes: new Map() };
    }
    const { renterTask, supplyTask } = pairTasks(left, right);
    if (renterTask.kind !== "renter" || supplyTask.kind !== "supply" || renterTask.ownerId === supplyTask.ownerId) {
      return { matchCase: null, evaluation: null, changes: new Map() };
    }
    const evaluation = evaluateTaskPair({
      renterTask,
      renterInputVersion: renterTask.inputVersion,
      supplyTask,
      supplyInputVersion: supplyTask.inputVersion,
      evaluatedAt
    });
    const changes = new Map([[renterTask.id, false], [supplyTask.id, false]]);

    return taskRepository.transaction(() => {
      const current = matchCaseRepository.findByPair(renterTask.id, supplyTask.id);
      if (evaluation.status === "hard_conflict") {
        if (current) matchCaseRepository.invalidate(current.id, "hard_conflict", "invalidated", evaluatedAt);
        changes.set(renterTask.id, taskRepository.removeCandidate(renterTask.id, supplyTask.id));
        changes.set(supplyTask.id, taskRepository.removeCandidate(supplyTask.id, renterTask.id));
        const invalidated = current ? matchCaseRepository.get(current.id) : null;
        if (invalidated) onCaseEvaluated?.({ matchCase: invalidated, evaluation, renterTask, supplyTask });
        return { matchCase: invalidated, evaluation, changes };
      }

      const matchCase = matchCaseRepository.upsertEvaluation({
        renterTask,
        supplyTask,
        evaluation,
        expiresAt: [renterTask.expiresAt, supplyTask.expiresAt].sort()[0]
      });
      changes.set(
        renterTask.id,
        taskRepository.upsertCandidate(renterTask.id, supplyTask.id, projectionForRenter(evaluation, matchCase, supplyTask), evaluatedAt)
      );
      changes.set(
        supplyTask.id,
        taskRepository.upsertCandidate(supplyTask.id, renterTask.id, projectionForSupply(evaluation, matchCase, renterTask), evaluatedAt)
      );
      onCaseEvaluated?.({ matchCase, evaluation, renterTask, supplyTask });
      return { matchCase, evaluation, changes };
    });
  }

  function removeInactiveCases(task, at) {
    const status = task.status === "expired" ? "expired" : "invalidated";
    return taskRepository.transaction(() => {
      let changed = false;
      for (const matchCase of matchCaseRepository.listForTask(task.id)) {
        const otherId = counterpartId(matchCase, task.id);
        changed = taskRepository.removeCandidate(task.id, otherId) || changed;
        taskRepository.removeCandidate(otherId, task.id);
        matchCaseRepository.invalidate(matchCase.id, `task_${task.status}`, status, at);
      }
      return changed;
    });
  }

  function recordRuns(taskIds, scannedByTask, changedByTask, at) {
    for (const taskId of taskIds) {
      taskRepository.recordMatchRun(taskId, {
        scanned: scannedByTask.get(taskId) || 0,
        changed: changedByTask.get(taskId) || false
      }, at);
    }
  }

  function processTask(taskId) {
    const task = taskRepository.get(taskId);
    if (!task) return null;
    const at = clock.nowIso();
    if (task.status !== "active") {
      removeInactiveCases(task, at);
      return { task: taskRepository.get(task.id), evaluatedPairs: 0 };
    }
    const opposites = taskRepository.listOpposite(task);
    const changedByTask = new Map([[task.id, false]]);
    const scannedByTask = new Map([[task.id, opposites.length]]);
    const activeOppositeIds = new Set(opposites.map((item) => item.id));

    taskRepository.transaction(() => {
      for (const opposite of opposites) {
        const processed = processPair(task, opposite, at);
        for (const [id, changed] of processed.changes) changedByTask.set(id, Boolean(changedByTask.get(id)) || changed);
        scannedByTask.set(opposite.id, taskRepository.listOpposite(opposite).length);
      }
      for (const existingCase of matchCaseRepository.listForTask(task.id)) {
        const otherId = counterpartId(existingCase, task.id);
        if (activeOppositeIds.has(otherId)) continue;
        changedByTask.set(task.id, taskRepository.removeCandidate(task.id, otherId) || Boolean(changedByTask.get(task.id)));
        taskRepository.removeCandidate(otherId, task.id);
        matchCaseRepository.invalidate(existingCase.id, "counterparty_inactive", "invalidated", at);
      }
      recordRuns(new Set([task.id, ...opposites.map((item) => item.id)]), scannedByTask, changedByTask, at);
    });
    return { task: taskRepository.get(task.id), evaluatedPairs: opposites.length };
  }

  function processAllActive() {
    for (const inactive of taskRepository.listInactiveWithCases()) removeInactiveCases(inactive, clock.nowIso());
    const renters = taskRepository.listActive("renter");
    const supplies = taskRepository.listActive("supply");
    const at = clock.nowIso();
    const changedByTask = new Map();
    const scannedByTask = new Map([
      ...renters.map((task) => [task.id, supplies.filter((supply) => supply.ownerId !== task.ownerId).length]),
      ...supplies.map((task) => [task.id, renters.filter((renter) => renter.ownerId !== task.ownerId).length])
    ]);
    let evaluatedPairs = 0;
    taskRepository.transaction(() => {
      for (const renter of renters) {
        for (const supply of supplies) {
          if (renter.ownerId === supply.ownerId) continue;
          const processed = processPair(renter, supply, at);
          evaluatedPairs += 1;
          for (const [id, changed] of processed.changes) changedByTask.set(id, Boolean(changedByTask.get(id)) || changed);
        }
      }
      recordRuns(new Set([...renters.map((task) => task.id), ...supplies.map((task) => task.id)]), scannedByTask, changedByTask, at);
    });
    return { evaluatedPairs, taskCount: renters.length + supplies.length };
  }

  return {
    processPair,
    processTask,
    processAllActive,
    invalidateTask(taskId) {
      const task = taskRepository.get(taskId);
      return task ? removeInactiveCases(task, clock.nowIso()) : false;
    }
  };
}
