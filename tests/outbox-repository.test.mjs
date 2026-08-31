import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClock } from "../src/clock.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createOutboxRepository } from "../src/server/outbox-repository.mjs";

async function fixture(t, prefix = "zhunaer-outbox-") {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  let nowMs = Date.parse("2026-08-31T00:00:00.000Z");
  const clock = createClock({ now: () => new Date(nowMs) });
  const database = openRentalDatabase(path.join(tempDir, "rental.sqlite"), { clock });
  const outbox = createOutboxRepository({ database, clock, lockTtlMs: 5_000, maxAttempts: 3, baseBackoffMs: 1_000 });
  t.after(async () => {
    database.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  return { database, outbox, clock, advance: (milliseconds) => { nowMs += milliseconds; } };
}

function addOwner(database, id) {
  database.createProfile({ id, tokenHash: `token-${id}` });
}

function addTask(database, id, { ownerId = "owner", clientRequestId = null } = {}) {
  return database.createTaskIdempotent({
    id,
    ownerId,
    kind: "renter",
    label: "测试任务",
    payload: { inputVersion: 1, mandate: { city: "上海" } },
    expiresAt: "2026-10-01T00:00:00.000Z",
    clientRequestId
  });
}

test("任务与 match_requested 原子提交，clientRequestId 重放不重复写事件", async (t) => {
  const { database } = await fixture(t, "zhunaer-outbox-atomic-");
  addOwner(database, "owner");
  database.raw.exec(`
    CREATE TRIGGER fail_selected_outbox
    BEFORE INSERT ON outbox_events
    WHEN NEW.aggregate_id = 'task-rollback'
    BEGIN
      SELECT RAISE(ABORT, 'forced outbox failure');
    END;
  `);
  assert.throws(() => addTask(database, "task-rollback"), /forced outbox failure/);
  assert.equal(database.getTask("task-rollback"), null);

  const first = addTask(database, "task-real", { clientRequestId: "request-0001" });
  const replay = addTask(database, "task-ignored", { clientRequestId: "request-0001" });
  assert.equal(first.created, true);
  assert.ok(first.enqueueLatencyMs >= 0);
  assert.equal(replay.created, false);
  assert.equal(replay.task.id, "task-real");
  assert.throws(() => database.createTaskIdempotent({
    id: "conflicting-supply",
    ownerId: "owner",
    kind: "supply",
    label: "冲突任务",
    payload: { draft: {}, inputVersion: 1 },
    expiresAt: "2026-10-01T00:00:00.000Z",
    clientRequestId: "request-0001"
  }), (error) => error.code === "CLIENT_REQUEST_CONFLICT" && error.status === 409);
  const events = database.raw.prepare("SELECT * FROM outbox_events WHERE aggregate_id = 'task-real'").all();
  assert.equal(events.length, 1);
  assert.equal(events[0].dedupe_key, "task:task-real:input:1");
});

test("状态和到期变化提升 input version，并原子写失效事件", async (t) => {
  const { database } = await fixture(t, "zhunaer-outbox-status-");
  addOwner(database, "owner");
  addTask(database, "task-status");
  const paused = database.setTaskStatus("task-status", "owner", "paused");
  assert.equal(paused.inputVersion, 2);
  assert.equal(paused.payload.inputVersion, 2);
  assert.equal(database.raw.prepare("SELECT event_type FROM outbox_events WHERE dedupe_key = 'task:task-status:input:2'").get().event_type, "task.match_invalidated");
  const active = database.setTaskStatus("task-status", "owner", "active");
  assert.equal(active.inputVersion, 3);
  assert.equal(database.raw.prepare("SELECT event_type FROM outbox_events WHERE dedupe_key = 'task:task-status:input:3'").get().event_type, "task.match_requested");

  database.raw.prepare("UPDATE tasks SET expires_at = ? WHERE id = ?").run("2026-08-30T00:00:00.000Z", "task-status");
  assert.equal(database.expireDueTasks(), 1);
  assert.equal(database.getTask("task-status").inputVersion, 4);
  assert.equal(database.raw.prepare("SELECT event_type FROM outbox_events WHERE dedupe_key = 'task:task-status:input:4'").get().event_type, "task.match_invalidated");
});

test("竞争领取、退避重试、过期锁回收和最终失败都有确定状态", async (t) => {
  const { database, outbox, advance } = await fixture(t, "zhunaer-outbox-lease-");
  addOwner(database, "owner");
  addTask(database, "task-lease");

  const claimedA = outbox.claimBatch("worker-a", 1);
  assert.equal(claimedA.length, 1);
  assert.equal(outbox.claimBatch("worker-b", 1).length, 0);
  assert.equal(outbox.complete(claimedA[0].id, "worker-b"), false);
  const retry = outbox.markFailure(claimedA[0].id, "worker-a", { code: "TEMPORARY" });
  assert.equal(retry.terminal, false);
  assert.equal(outbox.claimBatch("worker-b", 1).length, 0);
  advance(1_000);
  const claimedB = outbox.claimBatch("worker-b", 1);
  assert.equal(claimedB.length, 1);

  advance(5_001);
  assert.equal(outbox.requeueExpired(), 1);
  const reclaimed = outbox.claimBatch("worker-a", 1);
  assert.equal(reclaimed.length, 1);
  const second = outbox.markFailure(reclaimed[0].id, "worker-a", { code: "TEMPORARY" });
  advance(Date.parse(second.availableAt) - Date.parse("2026-08-31T00:00:06.001Z"));
  const finalClaim = outbox.claimBatch("worker-b", 1);
  assert.equal(finalClaim.length, 1);
  const terminal = outbox.markFailure(finalClaim[0].id, "worker-b", { code: "BROKEN_PERMANENTLY" });
  assert.equal(terminal.terminal, true);
  assert.equal(outbox.get(finalClaim[0].id).status, "failed");
  assert.equal(outbox.health().failed, 1);
  assert.equal(database.listEvents("task-lease").some((event) => event.type === "worker.match_failed"), true);
});

test("补偿器只为长期未匹配且没有待处理事件的任务补一个去重事件", async (t) => {
  const { database, outbox } = await fixture(t, "zhunaer-outbox-compensate-");
  addOwner(database, "owner");
  addTask(database, "task-compensate");
  database.raw.exec("DELETE FROM outbox_events");
  assert.equal(outbox.compensateUnmatched({ olderThanMs: 60_000 }), 1);
  assert.equal(outbox.compensateUnmatched({ olderThanMs: 60_000 }), 0);
  const event = database.raw.prepare("SELECT * FROM outbox_events WHERE aggregate_id = 'task-compensate'").get();
  assert.equal(event.event_type, "task.match_compensated");
  assert.equal(event.status, "pending");
});
