import { randomUUID } from "node:crypto";

import { createClock } from "../clock.mjs";

/** Claims durable events briefly, then performs idempotent matching outside the claim transaction. */
export function createMatchingWorker({
  outboxRepository,
  matchingService,
  clock = createClock(),
  workerId = `matching-${randomUUID()}`,
  batchSize = 20,
  handler = null
}) {
  if (!outboxRepository) throw new Error("matching worker requires outboxRepository");
  if (!matchingService && !handler) throw new Error("matching worker requires matchingService or handler");

  function processEvent(event) {
    if (handler) return handler(event);
    if (!["task.match_requested", "task.match_invalidated", "task.match_compensated", "task.media_changed"].includes(event.eventType)) {
      throw Object.assign(new Error("unsupported matching event"), { code: "OUTBOX_EVENT_UNSUPPORTED" });
    }
    return matchingService.processOutboxEvent(event, outboxRepository);
  }

  function runOnce() {
    const events = outboxRepository.claimBatch(workerId, batchSize);
    const metrics = {
      claimed: events.length,
      completed: 0,
      retried: 0,
      failed: 0,
      evaluatedPairs: 0,
      skippedJobs: 0,
      staleResultDiscards: 0,
      timeToFirstMatchMs: null
    };
    for (const event of events) {
      try {
        const result = processEvent(event) || {};
        if (!outboxRepository.complete(event.id, workerId)) {
          throw Object.assign(new Error("outbox lease was lost"), { code: "OUTBOX_LEASE_LOST" });
        }
        metrics.completed += 1;
        metrics.evaluatedPairs += Number(result.evaluatedPairs || 0);
        metrics.skippedJobs += Number(result.skippedPairs || 0);
        metrics.staleResultDiscards += Number(result.staleResultDiscards || 0);
        const latency = Math.max(0, clock.nowMs() - Date.parse(event.createdAt));
        metrics.timeToFirstMatchMs = metrics.timeToFirstMatchMs === null
          ? latency
          : Math.min(metrics.timeToFirstMatchMs, latency);
      } catch (error) {
        const failure = outboxRepository.markFailure(event.id, workerId, error);
        if (failure.terminal) metrics.failed += 1;
        else metrics.retried += 1;
        outboxRepository.recordError("matching", error, metrics);
      }
    }
    outboxRepository.recordSuccess("matching", metrics);
    return metrics;
  }

  function drain({ maxBatches = 100 } = {}) {
    const total = {
      batches: 0,
      claimed: 0,
      completed: 0,
      retried: 0,
      failed: 0,
      evaluatedPairs: 0,
      skippedJobs: 0,
      staleResultDiscards: 0,
      timeToFirstMatchMs: null
    };
    for (let index = 0; index < Math.max(1, Number(maxBatches) || 100); index += 1) {
      const current = runOnce();
      total.batches += 1;
      for (const key of ["claimed", "completed", "retried", "failed", "evaluatedPairs", "skippedJobs", "staleResultDiscards"]) {
        total[key] += current[key];
      }
      if (current.timeToFirstMatchMs !== null) {
        total.timeToFirstMatchMs = total.timeToFirstMatchMs === null
          ? current.timeToFirstMatchMs
          : Math.min(total.timeToFirstMatchMs, current.timeToFirstMatchMs);
      }
      if (current.claimed < batchSize) break;
    }
    outboxRepository.recordSuccess("matching", total);
    return total;
  }

  return {
    id: workerId,
    runOnce,
    drain,
    health: () => outboxRepository.health("matching")
  };
}
