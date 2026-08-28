import test from "node:test";
import assert from "node:assert/strict";
import {
  addDaysToIso,
  archiveExpiredTasks,
  createTaskLifecycle,
  evaluateTaskLifecycle,
  renewTaskLifecycle
} from "../src/task-lifecycle.mjs";

test("creates a 30-day task with a reminder five days before expiry", () => {
  const lifecycle = createTaskLifecycle("2026-08-28");
  assert.equal(lifecycle.expiresAt, "2026-09-27");
  assert.equal(lifecycle.renewalAt, "2026-09-22");
});

test("marks renewal as due during the final five days", () => {
  const lifecycle = createTaskLifecycle("2026-08-28");
  assert.equal(evaluateTaskLifecycle(lifecycle, "2026-09-21").renewalDue, false);
  assert.equal(evaluateTaskLifecycle(lifecycle, "2026-09-22").renewalDue, true);
  assert.equal(evaluateTaskLifecycle(lifecycle, "2026-09-27").expiresToday, true);
});

test("renews an active task from its current expiry date", () => {
  const lifecycle = createTaskLifecycle("2026-08-28");
  const renewed = renewTaskLifecycle(lifecycle, "2026-09-22");
  assert.equal(renewed.expiresAt, "2026-10-27");
  assert.equal(renewed.renewalCount, 1);
});

test("archives expired tasks and keeps active tasks isolated", () => {
  const active = { id: "active", lifecycle: createTaskLifecycle("2026-08-28") };
  const expired = { id: "expired", lifecycle: createTaskLifecycle("2026-07-01") };
  const result = archiveExpiredTasks([active, expired], "2026-08-28");
  assert.deepEqual(result.active.map((task) => task.id), ["active"]);
  assert.deepEqual(result.archived.map((task) => task.id), ["expired"]);
  assert.equal(result.archived[0].archivedReason, "expired");
});

test("date math remains stable across month boundaries", () => {
  assert.equal(addDaysToIso("2026-01-31", 30), "2026-03-02");
});
