import { createHash } from "node:crypto";

const PRIVATE_KEYS = /^(?:hardMax|minimumAuthorizedRent|minRent|exactAddress|address|rawText|evidenceRefs|storagePath|contact|sessionToken|token)$/iu;
const TOP_LEVEL_KEYS = new Set([
  "rent",
  "leaseMonths",
  "moveInWindow",
  "feeSummary",
  "approximateLocation",
  "viewingAvailability",
  "highlights"
]);
const NESTED_KEYS = {
  moveInWindow: new Set(["from", "to"]),
  feeSummary: new Set(["service", "intermediary", "utilitiesPolicy"])
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} 必须是对象`);
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (PRIVATE_KEYS.test(key)) throw new Error(`${label} 包含 private field 私密字段：${key}`);
    if (!allowed.has(key)) throw new Error(`${label} 包含未允许字段：${key}`);
  }
}

function integerOrNull(value, label, { minimum = 0 } = {}) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new TypeError(`${label} 必须使用整数元`);
  return number;
}

function shortStringOrNull(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!text || text.length > 160) throw new TypeError(`${label} 文本不合法`);
  return text;
}

function normalizeDateRange(value) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, "moveInWindow");
  assertAllowedKeys(value, NESTED_KEYS.moveInWindow, "moveInWindow");
  const from = String(value.from || "");
  const to = String(value.to || "");
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) throw new TypeError("入住日期必须使用 ISO YYYY-MM-DD");
  if (from > to) throw new TypeError("入住日期范围不合法");
  return { from, to };
}

function normalizeFeeSummary(value) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, "feeSummary");
  assertAllowedKeys(value, NESTED_KEYS.feeSummary, "feeSummary");
  return {
    intermediary: integerOrNull(value.intermediary, "intermediary"),
    service: integerOrNull(value.service, "service"),
    utilitiesPolicy: shortStringOrNull(value.utilitiesPolicy, "utilitiesPolicy")
  };
}

function uniqueSortedStrings(value, label) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} 必须是数组`);
  return [...new Set(value.map((item) => shortStringOrNull(item, label)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

/** Normalizes exactly the fields both parties are allowed to confirm. */
export function normalizePublicTerms(publicTerms) {
  assertPlainObject(publicTerms, "publicTerms");
  assertAllowedKeys(publicTerms, TOP_LEVEL_KEYS, "publicTerms");
  return {
    approximateLocation: shortStringOrNull(publicTerms.approximateLocation, "approximateLocation"),
    feeSummary: normalizeFeeSummary(publicTerms.feeSummary),
    highlights: uniqueSortedStrings(publicTerms.highlights, "highlights"),
    leaseMonths: integerOrNull(publicTerms.leaseMonths, "leaseMonths", { minimum: 1 }),
    moveInWindow: normalizeDateRange(publicTerms.moveInWindow),
    rent: integerOrNull(publicTerms.rent, "rent", { minimum: 1 }),
    viewingAvailability: shortStringOrNull(publicTerms.viewingAvailability, "viewingAvailability")
  };
}

export function canonicalizePublicTerms(publicTerms) {
  return JSON.stringify(sortKeys(normalizePublicTerms(publicTerms)));
}

export function hashPublicTerms(publicTerms) {
  const digest = createHash("sha256").update(canonicalizePublicTerms(publicTerms)).digest("hex");
  return `sha256:${digest}`;
}
