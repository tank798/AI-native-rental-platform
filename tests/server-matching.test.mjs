import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createMatchingService } from "../src/server/matching-service.mjs";

async function createMatchingFixture(t, prefix, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const repository = openRentalDatabase(path.join(tempDir, "rental.sqlite"));
  const matching = createMatchingService(repository, options);
  t.after(async () => {
    repository.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  repository.createProfile({ id: "owner-renter", tokenHash: `${prefix}-token` });
  const mandate = structuredClone(baseMandate);
  mandate.id = `${prefix}-mandate`;
  const task = repository.createTask({
    id: `${prefix}-task`,
    ownerId: "owner-renter",
    kind: "renter",
    label: mandate.locations.join(" / "),
    payload: { mandate, rawText: "测试真实市场与演示市场分流" },
    expiresAt: "2026-10-01T00:00:00.000Z"
  });
  return { repository, matching, task };
}

test("默认真实市场只扫描数据库中的真实对手任务", async (t) => {
  const { matching, task } = await createMatchingFixture(t, "zhunaer-real-market-");

  matching.processAfterTaskCreated(task.id);
  const snapshot = matching.snapshot(task.id);

  assert.equal(matching.marketMode, "real");
  assert.equal(snapshot.task.scanned, 0);
  assert.deepEqual(snapshot.candidates, []);
  assert.equal(matching.matchCaseRepository.list().length, 0);
});

test("显式演示模式会注入语料并把每个候选标记为 fixture", async (t) => {
  const { matching, task } = await createMatchingFixture(t, "zhunaer-demo-market-", { marketMode: "demo" });

  matching.processAfterTaskCreated(task.id);
  const snapshot = matching.snapshot(task.id);

  assert.equal(matching.marketMode, "demo");
  assert.equal(snapshot.task.scanned, 100);
  assert.ok(snapshot.candidates.length > 0);
  assert.equal(snapshot.candidates.every((candidate) => candidate.counterpartyType === "fixture"), true);
  assert.equal(matching.matchCaseRepository.list().length, 0);
});

test("持续匹配会把新房源增量推送到租客，也把新租客推送到房东", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-matching-"));
  const repository = openRentalDatabase(path.join(tempDir, "rental.sqlite"));
  const matching = createMatchingService(repository);
  t.after(async () => {
    repository.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  repository.createProfile({ id: "owner-renter", tokenHash: "token-renter" });
  repository.createProfile({ id: "owner-supply", tokenHash: "token-supply" });

  const mandate = structuredClone(baseMandate);
  mandate.id = "mandate-live-renter";
  mandate.locations = ["临港新城"];
  mandate.budget = { ...mandate.budget, target: 3000, hardMax: 3400 };
  mandate.moveInWindow = { from: "2026-09-01", to: "2026-09-08" };
  mandate.maxCommuteMinutes = 40;
  const renterTask = repository.createTask({
    id: "task-live-renter",
    ownerId: "owner-renter",
    kind: "renter",
    label: "临港新城",
    payload: { mandate, rawText: "临港新城找房" },
    expiresAt: "2026-10-01T00:00:00.000Z"
  });
  matching.processAfterTaskCreated(renterTask.id);
  assert.equal(repository.listCandidates(renterTask.id).length, 0);

  const draft = structuredClone(demoSupplyDraft);
  draft.location = "临港新城";
  draft.station = "滴水湖站";
  draft.district = "浦东新区";
  draft.address = "浦东新区海港大道 999 号";
  draft.title = "临港新城个人直租";
  draft.availableFrom = "2026-09-03";
  const supplyTask = repository.createTask({
    id: "task-live-supply",
    ownerId: "owner-supply",
    kind: "supply",
    label: draft.title,
    payload: { draft, rawText: "临港新城房源" },
    expiresAt: "2026-10-01T00:00:00.000Z"
  });
  matching.processAfterTaskCreated(supplyTask.id);

  const renterCandidates = matching.snapshot(renterTask.id).candidates;
  assert.equal(renterCandidates.length, 1);
  assert.ok(renterCandidates[0].matchCaseId);
  assert.equal(renterCandidates[0].listing.minRent, undefined);
  assert.doesNotMatch(renterCandidates[0].listing.addressHint, /海港大道/);

  const supplyCandidates = matching.snapshot(supplyTask.id).candidates;
  assert.equal(supplyCandidates.length, 1);
  assert.equal(supplyCandidates[0].matchCaseId, renterCandidates[0].matchCaseId);
  assert.equal(supplyCandidates[0].tenant.mandate.budget, undefined);
  assert.match(supplyCandidates[0].displayAlias, /^租客 /);

  const matchCases = matching.matchCaseRepository.list();
  assert.equal(matchCases.length, 1);
  assert.equal(matchCases[0].status, "terms_ready");
  assert.equal(matchCases[0].renterTaskId, renterTask.id);
  assert.equal(matchCases[0].supplyTaskId, supplyTask.id);

  const beforeVersion = repository.getTask(renterTask.id).candidateVersion;
  matching.processAllActive();
  assert.ok(repository.getTask(renterTask.id).runCount >= 2);
  assert.equal(repository.getTask(renterTask.id).candidateVersion, beforeVersion);
  assert.equal(matching.matchCaseRepository.listEvents(matchCases[0].id).filter((event) => event.type === "case_created").length, 1);
});

test("持续扫描会先停止已经过期的任务", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-expiry-"));
  const repository = openRentalDatabase(path.join(tempDir, "rental.sqlite"));
  const matching = createMatchingService(repository);
  t.after(async () => {
    repository.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  repository.createProfile({ id: "owner-expired", tokenHash: "token-expired" });
  repository.createTask({
    id: "task-expired",
    ownerId: "owner-expired",
    kind: "renter",
    label: "已过期",
    payload: { mandate: structuredClone(baseMandate) },
    expiresAt: "2020-01-01T00:00:00.000Z"
  });
  matching.processAllActive();
  assert.equal(repository.getTask("task-expired").status, "expired");
  assert.equal(repository.listEvents("task-expired").some((event) => event.type === "task.expired"), true);
});
