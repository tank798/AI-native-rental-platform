import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClock } from "../src/clock.mjs";
import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createMatchingService } from "../src/server/matching-service.mjs";
import { createMatchingWorker } from "../src/server/matching-worker.mjs";
import { createOutboxRepository } from "../src/server/outbox-repository.mjs";
import { createTaskRepository } from "../src/server/task-repository.mjs";
import { testContactEncryptionKey } from "./test-secrets.mjs";

async function fixture(t, prefix = "zhunaer-worker-") {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  let nowMs = Date.parse("2026-08-31T00:00:00.000Z");
  const clock = createClock({ now: () => new Date(nowMs) });
  const database = openRentalDatabase(path.join(tempDir, "rental.sqlite"), { clock });
  const matching = createMatchingService(database, { clock, contactEncryptionKey: testContactEncryptionKey() });
  const outbox = createOutboxRepository({ database, clock, maxAttempts: 3, baseBackoffMs: 100 });
  const worker = createMatchingWorker({ outboxRepository: outbox, matchingService: matching, clock, batchSize: 25 });
  t.after(async () => {
    database.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  return { database, matching, outbox, worker, clock, advance: (milliseconds) => { nowMs += milliseconds; } };
}

function createProfiles(database, count) {
  for (let index = 0; index < count; index += 1) {
    database.createProfile({ id: `owner-${index}`, tokenHash: `token-${index}` });
  }
}

test("旧版本事件被丢弃，新版本事件只生成一个幂等 pair job", async (t) => {
  const { database, worker, clock } = await fixture(t, "zhunaer-worker-stale-");
  createProfiles(database, 2);
  const mandate = structuredClone(baseMandate);
  mandate.city = "上海";
  mandate.locations = ["静安寺"];
  database.createTask({
    id: "renter",
    ownerId: "owner-0",
    kind: "renter",
    label: "租客",
    payload: { inputVersion: 1, mandate },
    expiresAt: "2026-10-01T00:00:00.000Z"
  });
  const draft = structuredClone(demoSupplyDraft);
  draft.city = "上海";
  draft.location = "静安寺";
  database.createTask({
    id: "supply",
    ownerId: "owner-1",
    kind: "supply",
    label: "房源",
    payload: { inputVersion: 1, draft },
    expiresAt: "2026-10-01T00:00:00.000Z"
  });
  const tasks = createTaskRepository({ database, clock });
  tasks.applyFieldAnswer({
    taskId: "renter",
    fieldKey: "budget.hardMax",
    value: 3_500,
    nextPayload: { inputVersion: 1, mandate: { ...mandate, budget: { ...mandate.budget, hardMax: 3_500 } } }
  });

  const metrics = worker.drain();
  assert.ok(metrics.staleResultDiscards >= 1);
  assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM match_jobs").get().count, 1);
  assert.equal(database.raw.prepare("SELECT renter_input_version FROM match_jobs").get().renter_input_version, 2);
  assert.equal(worker.drain().evaluatedPairs, 0);
});

test("200×50 市场修改一个任务时只评估粗筛受影响集合", async (t) => {
  const { database, worker, clock } = await fixture(t, "zhunaer-worker-performance-");
  createProfiles(database, 250);
  for (let index = 0; index < 200; index += 1) {
    const mandate = structuredClone(baseMandate);
    mandate.id = `mandate-${index}`;
    mandate.city = "上海";
    mandate.locations = [index === 0 ? "目标片区" : `租客片区-${index}`];
    mandate.commuteDestinations = [];
    database.createTask({
      id: `renter-${index}`,
      ownerId: `owner-${index}`,
      kind: "renter",
      label: mandate.locations[0],
      payload: { inputVersion: 1, mandate },
      expiresAt: "2026-10-01T00:00:00.000Z"
    });
  }
  for (let index = 0; index < 50; index += 1) {
    const draft = structuredClone(demoSupplyDraft);
    draft.city = "上海";
    draft.location = index < 10 ? "目标片区" : `房源片区-${index}`;
    database.createTask({
      id: `supply-${index}`,
      ownerId: `owner-${200 + index}`,
      kind: "supply",
      label: draft.location,
      payload: { inputVersion: 1, draft },
      expiresAt: "2026-10-01T00:00:00.000Z"
    });
  }
  database.raw.exec("DELETE FROM outbox_events");
  const taskRepository = createTaskRepository({ database, clock });
  const task = taskRepository.get("renter-0");
  taskRepository.applyFieldAnswer({
    taskId: task.id,
    fieldKey: "budget.hardMax",
    value: 3_600,
    nextPayload: {
      ...task.payload,
      mandate: { ...task.payload.mandate, budget: { ...task.payload.mandate.budget, hardMax: 3_600 } }
    }
  });

  const metrics = worker.drain();
  const jobs = database.raw.prepare("SELECT COUNT(*) AS count FROM match_jobs").get().count;
  assert.equal(metrics.evaluatedPairs, 10);
  assert.equal(jobs, 10);
  assert.ok(metrics.evaluatedPairs < 10_000);
  const health = worker.health();
  assert.equal(health.failed, 0);
  assert.ok(health.jobP95Ms >= 0);
});
