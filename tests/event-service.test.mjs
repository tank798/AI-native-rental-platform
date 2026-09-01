import assert from "node:assert/strict";
import test from "node:test";

import { createClock } from "../src/clock.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createEventService } from "../src/server/event-service.mjs";
import { summarizeEvents } from "../scripts/metrics-summary.mjs";

test("产品事件按 schema 写入、按 dedupe key 幂等且不接受未知字段", (t) => {
  const clock = createClock({ now: () => new Date("2026-08-31T00:00:00.000Z") });
  const database = openRentalDatabase(":memory:", { clock });
  t.after(() => database.close());
  const events = createEventService({ database, clock });
  const input = {
    type: "confirmation.recorded",
    aggregateId: "case-1",
    payload: { party: "renter", termsVersion: 2, latencyMs: 18_342 },
    dedupeKey: "confirmation:case-1:renter:2"
  };
  assert.equal(events.record(input).inserted, true);
  assert.equal(events.record(input).inserted, false);
  assert.equal(events.list().length, 1);
  assert.throws(() => events.record({ ...input, dedupeKey: "bad-extra", payload: { ...input.payload, score: 1 } }), /unsupported keys/u);
});

test("任何层级的私密字段名或字段名字符串都被事件边界拒绝", (t) => {
  const database = openRentalDatabase(":memory:");
  t.after(() => database.close());
  const events = createEventService({ database });
  const privateNames = ["contact", "hardMax", "minRent", "exactAddress", "rawText", "evidencePath", "sessionToken"];
  for (const name of privateNames) {
    assert.throws(() => events.record({
      type: "task.activated",
      aggregateId: `task-${name}`,
      payload: { kind: "renter", inputVersion: 1, lifecycleVersion: { [name]: "secret" } },
      dedupeKey: `private-key:${name}`
    }), /private/u);
    assert.throws(() => events.record({
      type: "task.paused",
      aggregateId: `task-value-${name}`,
      payload: { inputVersion: `contains ${name}` },
      dedupeKey: `private-value:${name}`
    }), /private/u);
  }
  assert.equal(events.list().length, 0);
});

test("指标摘要只输出聚合漏斗和安全计数", () => {
  const at = "2026-08-31T00:00:00.000Z";
  const summary = summarizeEvents([
    { type: "task.activated", aggregateId: "task-r", payload: {}, createdAt: at },
    { type: "candidate.created", aggregateId: "task-r", payload: { latencyMs: 1_000 }, createdAt: at },
    { type: "terms.ready", aggregateId: "case-1", payload: {}, createdAt: at },
    { type: "confirmation.recorded", aggregateId: "case-1", payload: { party: "renter" }, createdAt: at },
    { type: "confirmation.recorded", aggregateId: "case-1", payload: { party: "supply" }, createdAt: at },
    { type: "contact.unlocked", aggregateId: "case-1", payload: {}, createdAt: at },
    { type: "contact.viewed", aggregateId: "case-1", payload: { party: "renter" }, createdAt: at },
    { type: "viewing.proposed", aggregateId: "case-1", payload: {}, createdAt: at }
  ]);
  assert.deepEqual(summary, {
    activatedRealTasks: 1,
    tasksWithCandidateWithin24h: 1,
    clarificationCompletionRate: 0,
    oneSidedConfirmationRate: 1,
    mutualConfirmationRate: 1,
    contactViewRate: 1,
    viewingProposalRate: 1,
    privateLeakCount: 0,
    prematureUnlockCount: 0
  });
});
