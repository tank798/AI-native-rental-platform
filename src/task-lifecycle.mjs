const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDay(value) {
  const text = String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new TypeError(`Invalid ISO date: ${text}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function addDaysToIso(isoDate, days) {
  const date = new Date(toUtcDay(isoDate) + Number(days) * DAY_MS);
  return date.toISOString().slice(0, 10);
}

export function daysUntil(isoDate, nowIso) {
  return Math.ceil((toUtcDay(isoDate) - toUtcDay(nowIso)) / DAY_MS);
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
