import { addDaysToIso, daysBetweenIsoDates } from "./clock.mjs";

export { addDaysToIso } from "./clock.mjs";

export function daysUntil(isoDate, nowIso) {
  return daysBetweenIsoDates(nowIso, isoDate);
}

export function createTaskLifecycle(createdAt, { durationDays = 30, renewalLeadDays = 5 } = {}) {
  const expiresAt = addDaysToIso(createdAt, durationDays);
  return {
    createdAt,
    expiresAt,
    renewalAt: addDaysToIso(expiresAt, -renewalLeadDays),
    durationDays,
    renewalLeadDays,
    renewalCount: 0
  };
}

export function evaluateTaskLifecycle(lifecycle, nowIso) {
  const daysRemaining = daysUntil(lifecycle.expiresAt, nowIso);
  return {
    daysRemaining,
    expired: daysRemaining < 0,
    expiresToday: daysRemaining === 0,
    renewalDue: daysRemaining >= 0 && daysRemaining <= lifecycle.renewalLeadDays,
    status: daysRemaining < 0 ? "expired" : daysRemaining <= lifecycle.renewalLeadDays ? "renewal_due" : "active"
  };
}

export function renewTaskLifecycle(lifecycle, nowIso) {
  const stillActive = daysUntil(lifecycle.expiresAt, nowIso) >= 0;
  const baseDate = stillActive ? lifecycle.expiresAt : nowIso;
  const expiresAt = addDaysToIso(baseDate, lifecycle.durationDays);
  return {
    ...lifecycle,
    expiresAt,
    renewalAt: addDaysToIso(expiresAt, -lifecycle.renewalLeadDays),
    renewalCount: Number(lifecycle.renewalCount || 0) + 1
  };
}

export function archiveExpiredTasks(tasks, nowIso) {
  return tasks.reduce((result, task) => {
    const lifecycleState = evaluateTaskLifecycle(task.lifecycle, nowIso);
    const nextTask = { ...task, lifecycleState };
    if (lifecycleState.expired) result.archived.push({ ...nextTask, archivedReason: "expired" });
    else result.active.push(nextTask);
    return result;
  }, { active: [], archived: [] });
}
