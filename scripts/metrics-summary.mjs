import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const PRIVATE_PATTERN = /contact|hardMax|minRent|exactAddress|rawText|evidencePath|sessionToken/iu;

function rate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

export function summarizeEvents(events) {
  const byType = (type) => events.filter((event) => event.type === type);
  const activated = new Set(byType("task.activated").map((event) => event.aggregateId));
  const candidatesWithin24h = new Set(byType("candidate.created")
    .filter((event) => Number(event.payload?.latencyMs) <= 24 * 60 * 60 * 1000)
    .map((event) => event.aggregateId));
  const clarificationRequested = byType("clarification.requested");
  const clarificationCompleted = byType("clarification.completed");
  const termsCases = new Set(byType("terms.ready").map((event) => event.aggregateId));
  const confirmationsByCase = new Map();
  for (const event of byType("confirmation.recorded")) {
    if (!confirmationsByCase.has(event.aggregateId)) confirmationsByCase.set(event.aggregateId, new Set());
    confirmationsByCase.get(event.aggregateId).add(event.payload?.party);
  }
  const oneSided = [...termsCases].filter((id) => (confirmationsByCase.get(id)?.size || 0) >= 1).length;
  const mutual = [...termsCases].filter((id) => (confirmationsByCase.get(id)?.size || 0) >= 2).length;
  const unlockedCases = new Set(byType("contact.unlocked").map((event) => event.aggregateId));
  const viewedCases = new Set(byType("contact.viewed").map((event) => event.aggregateId));
  const viewingCases = new Set(byType("viewing.proposed").map((event) => event.aggregateId));
  let privateLeakCount = 0;
  let prematureUnlockCount = 0;
  const sorted = [...events].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  const confirmationsSeen = new Map();
  for (const event of sorted) {
    if (PRIVATE_PATTERN.test(JSON.stringify(event.payload || {}))) privateLeakCount += 1;
    if (event.type === "confirmation.recorded") {
      if (!confirmationsSeen.has(event.aggregateId)) confirmationsSeen.set(event.aggregateId, new Set());
      confirmationsSeen.get(event.aggregateId).add(event.payload?.party);
    }
    if (event.type === "contact.unlocked" && (confirmationsSeen.get(event.aggregateId)?.size || 0) < 2) prematureUnlockCount += 1;
  }
  return {
    activatedRealTasks: activated.size,
    tasksWithCandidateWithin24h: candidatesWithin24h.size,
    clarificationCompletionRate: rate(clarificationCompleted.length, clarificationRequested.length),
    oneSidedConfirmationRate: rate(oneSided, termsCases.size),
    mutualConfirmationRate: rate(mutual, termsCases.size),
    contactViewRate: rate([...viewedCases].filter((id) => unlockedCases.has(id)).length, unlockedCases.size),
    viewingProposalRate: rate([...viewingCases].filter((id) => unlockedCases.has(id)).length, unlockedCases.size),
    privateLeakCount,
    prematureUnlockCount
  };
}

function emptySummary() {
  return summarizeEvents([]);
}

export function readMetrics(databasePath) {
  if (!databasePath || !fs.existsSync(databasePath)) return emptySummary();
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const exists = database.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'product_events'").get();
    if (!exists) return emptySummary();
    const events = database.prepare("SELECT type, aggregate_id, payload_json, created_at FROM product_events ORDER BY created_at ASC, rowid ASC").all()
      .map((row) => ({ type: row.type, aggregateId: row.aggregate_id, payload: JSON.parse(row.payload_json), createdAt: row.created_at }));
    return summarizeEvents(events);
  } finally {
    database.close();
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  const databasePath = argumentValue("--database");
  if (!databasePath) {
    console.error("Usage: node scripts/metrics-summary.mjs --database <sqlite-file>");
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(readMetrics(path.resolve(databasePath)), null, 2));
  }
}

