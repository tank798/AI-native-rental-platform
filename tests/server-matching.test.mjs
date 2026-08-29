import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createMatchingService } from "../src/server/matching-service.mjs";

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
  assert.equal(renterCandidates[0].listing.minRent, undefined);
  assert.doesNotMatch(renterCandidates[0].listing.addressHint, /海港大道/);

  const supplyCandidates = matching.snapshot(supplyTask.id).candidates;
  assert.equal(supplyCandidates.length, 1);
  assert.equal(supplyCandidates[0].tenant.mandate.budget, undefined);
  assert.match(supplyCandidates[0].displayAlias, /^租客 /);

  const beforeVersion = repository.getTask(renterTask.id).candidateVersion;
  matching.processAllActive();
  assert.ok(repository.getTask(renterTask.id).runCount >= 2);
  assert.equal(repository.getTask(renterTask.id).candidateVersion, beforeVersion);
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
