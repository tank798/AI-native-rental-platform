const DAY_MS = 24 * 60 * 60 * 1_000;
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

function partsForIsoDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(isoDate || ""));
  if (!match) throw new TypeError(`Invalid ISO date: ${isoDate}`);
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (probe.getUTCFullYear() !== parts.year || probe.getUTCMonth() + 1 !== parts.month || probe.getUTCDate() !== parts.day) {
    throw new TypeError(`Invalid ISO date: ${isoDate}`);
  }
  return parts;
}

function isoDateFromUtcMilliseconds(milliseconds) {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

export function isoDateToUtcMilliseconds(isoDate) {
  const { year, month, day } = partsForIsoDate(isoDate);
  return Date.UTC(year, month - 1, day);
}

export function addDaysToIso(isoDate, days) {
  return isoDateFromUtcMilliseconds(isoDateToUtcMilliseconds(isoDate) + Number(days) * DAY_MS);
}

export function daysBetweenIsoDates(from, to) {
  return Math.round((isoDateToUtcMilliseconds(to) - isoDateToUtcMilliseconds(from)) / DAY_MS);
}

export function compareIsoDates(left, right) {
  const leftMs = isoDateToUtcMilliseconds(left);
  const rightMs = isoDateToUtcMilliseconds(right);
  return leftMs === rightMs ? 0 : leftMs < rightMs ? -1 : 1;
}

export function daysInIsoMonth(year, month) {
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
}

export function dateAtShanghaiNoon(isoDate) {
  partsForIsoDate(isoDate);
  return new Date(`${isoDate}T12:00:00+08:00`);
}

export function isoDateToShanghaiNoonMilliseconds(isoDate) {
  return dateAtShanghaiNoon(isoDate).getTime();
}

export function createClock({ now = () => new Date() } = {}) {
  function current() {
    const supplied = now();
    const date = supplied instanceof Date ? new Date(supplied.getTime()) : new Date(supplied);
    if (!Number.isFinite(date.getTime())) throw new TypeError("Clock returned an invalid date");
    return date;
  }

  return {
    now: current,
    nowMs: () => current().getTime(),
    nowIso: () => current().toISOString(),
    todayInShanghai() {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: SHANGHAI_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(current());
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    }
  };
}

export function isoTimestampAfterDays(clock, days) {
  return isoTimestampFromMilliseconds(clock.nowMs() + Number(days) * DAY_MS);
}

export function isoTimestampFromMilliseconds(milliseconds) {
  return new Date(Number(milliseconds)).toISOString();
}

export const clockConstants = {
  dayMs: DAY_MS,
  shanghaiTimeZone: SHANGHAI_TIME_ZONE
};
