import test from "node:test";
import assert from "node:assert/strict";
import {
  addDaysToIso,
  archiveExpiredTasks,
  createTaskLifecycle,
  evaluateTaskLifecycle,
  renewTaskLifecycle
} from "../src/task-lifecycle.mjs";
import { createClock } from "../src/clock.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";

test("creates a 14-day task with a reminder 48 hours before expiry", () => {
  const lifecycle = createTaskLifecycle("2026-08-28");
  assert.equal(lifecycle.expiresAt, "2026-09-11");
  assert.equal(lifecycle.renewalAt, "2026-09-09");
});

test("marks renewal as due during the final two days", () => {
  const lifecycle = createTaskLifecycle("2026-08-28");
  assert.equal(evaluateTaskLifecycle(lifecycle, "2026-09-08").renewalDue, false);
  assert.equal(evaluateTaskLifecycle(lifecycle, "2026-09-09").renewalDue, true);
  assert.equal(evaluateTaskLifecycle(lifecycle, "2026-09-11").expiresToday, true);
});

test("renews an active task from its current expiry date", () => {
  const lifecycle = createTaskLifecycle("2026-08-28");
  const renewed = renewTaskLifecycle(lifecycle, "2026-09-09");
  assert.equal(renewed.expiresAt, "2026-09-25");
  assert.equal(renewed.renewalCount, 1);
  assert.equal(renewed.lifecycleVersion, 2);
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
  assert.equal(addDaysToIso("2026-01-31", 14), "2026-02-14");
});

test("server renewal increments input and lifecycle versions while expired tasks stay read-only", (t) => {
  const clock = createClock({ now: () => new Date("2026-08-31T00:00:00.000Z") });
  const database = openRentalDatabase(":memory:", { clock });
  t.after(() => database.close());
  database.createProfile({ id: "owner", tokenHash: "lifecycle-owner" });
  database.createTask({ id: "active", ownerId: "owner", kind: "renter", label: "active", payload: {}, expiresAt: "2026-09-14T00:00:00.000Z" });
  const renewed = database.renewTask("active", "owner", "2026-09-28T00:00:00.000Z");
  assert.equal(renewed.inputVersion, 2);
  assert.equal(renewed.lifecycleVersion, 2);
  assert.equal(renewed.expiresAt, "2026-09-28T00:00:00.000Z");

  database.createTask({ id: "expired", ownerId: "owner", kind: "renter", label: "expired", payload: {}, expiresAt: "2026-08-30T00:00:00.000Z" });
  database.expireDueTasks();
  assert.equal(database.getTask("expired").status, "expired");
  assert.throws(() => database.setTaskStatus("expired", "owner", "active"), (error) => error.code === "TASK_EXPIRED_READ_ONLY");
  assert.throws(() => database.renewTask("expired", "owner", "2026-09-14T00:00:00.000Z"), (error) => error.code === "TASK_NOT_RENEWABLE");
});
