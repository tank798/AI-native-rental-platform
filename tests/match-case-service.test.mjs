import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createClock } from "../src/clock.mjs";
import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createMatchCaseRepository } from "../src/server/match-case-repository.mjs";
import { createMatchCaseService } from "../src/server/match-case-service.mjs";
import { createTaskRepository } from "../src/server/task-repository.mjs";

const expiresAt = "2026-09-29T00:00:00.000Z";

async function fixture(t, prefix = "zhunaer-case-service-") {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const clock = createClock({ now: () => new Date("2026-08-30T00:00:00.000Z") });
  const database = openRentalDatabase(path.join(tempDir, "rental.sqlite"), { clock });
  const taskRepository = createTaskRepository({ database, clock });
  const matchCaseRepository = createMatchCaseRepository({ database, clock });
  const service = createMatchCaseService({ taskRepository, matchCaseRepository, clock });
  t.after(async () => {
    database.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  for (const owner of ["owner-r", "owner-s1", "owner-s2", "owner-same"]) {
    database.createProfile({ id: owner, tokenHash: `${prefix}-${owner}` });
  }
  database.createTask({
    id: "renter",
    ownerId: "owner-r",
    kind: "renter",
    label: "静安寺",
    payload: { mandate: structuredClone(baseMandate), inputVersion: 1 },
    inputVersion: 1,
    expiresAt
  });
  return { database, taskRepository, matchCaseRepository, service };
}

function addSupply(database, { id, ownerId, draft, inputVersion = 1 }) {
  return database.createTask({
    id,
    ownerId,
    kind: "supply",
    label: draft.title || id,
    payload: { draft: structuredClone(draft), inputVersion },
    inputVersion,
    expiresAt
  });
}

test("真实顺序：无供给无案例，硬冲突不成案，未知项形成 clarifying，解决后同一案例进入 terms_ready", async (t) => {
  const { database, taskRepository, matchCaseRepository, service } = await fixture(t);
  assert.equal(service.processTask("renter").evaluatedPairs, 0);
  assert.equal(matchCaseRepository.list().length, 0);

  addSupply(database, {
    id: "supply-conflict",
    ownerId: "owner-s1",
    draft: { ...structuredClone(demoSupplyDraft), minimumAuthorizedRent: 4_000, listedRent: 4_200 }
  });
  service.processTask("renter");
  assert.equal(matchCaseRepository.list().length, 0);

  const unknownDraft = structuredClone(demoSupplyDraft);
  unknownDraft.facilities.kitchen = null;
  addSupply(database, { id: "supply-unknown", ownerId: "owner-s2", draft: unknownDraft });
  service.processTask("renter");
  const clarifying = matchCaseRepository.findByPair("renter", "supply-unknown");
  assert.equal(clarifying.status, "clarifying");
  assert.ok(clarifying.terms.blockingUnknowns.some((item) => item.fieldKey === "listing.facilities.kitchen"));
  assert.equal(taskRepository.listCandidates("renter").length, 1);
  assert.equal(taskRepository.listCandidates("supply-unknown").length, 1);

  unknownDraft.facilities.kitchen = true;
  database.raw.prepare("UPDATE tasks SET payload_json = ?, input_version = 2 WHERE id = 'supply-unknown'").run(
    JSON.stringify({ draft: unknownDraft, inputVersion: 2 })
  );
  service.processTask("supply-unknown");
  const ready = matchCaseRepository.findByPair("renter", "supply-unknown");
  assert.equal(ready.id, clarifying.id);
  assert.equal(ready.status, "terms_ready");
  assert.equal(ready.supplyInputVersion, 2);

  service.processTask("supply-unknown");
  assert.equal(matchCaseRepository.list().length, 1);
  assert.equal(matchCaseRepository.listEvents(ready.id).filter((event) => event.type === "case_created").length, 1);
});

test("demo fixture 和同 owner 任务不生成案例", async (t) => {
  const { database, taskRepository, matchCaseRepository, service } = await fixture(t, "zhunaer-case-boundaries-");
  addSupply(database, { id: "supply-same", ownerId: "owner-r", draft: demoSupplyDraft });
  service.processTask("renter");
  assert.equal(matchCaseRepository.list().length, 0);

  const renter = taskRepository.get("renter");
  const fixtureSupply = { ...taskRepository.get("supply-same"), id: "fixture-supply", ownerId: "fixture", __fixture: true };
  assert.equal(service.processPair(renter, fixtureSupply).matchCase, null);
  assert.equal(matchCaseRepository.list().length, 0);
});

test("任务暂停、关闭或过期后案例失效且双方候选同步移除", async (t) => {
  const { database, taskRepository, matchCaseRepository, service } = await fixture(t, "zhunaer-case-invalidation-");
  addSupply(database, { id: "supply", ownerId: "owner-s1", draft: demoSupplyDraft });
  service.processTask("renter");
  const created = matchCaseRepository.findByPair("renter", "supply");
  assert.equal(created.status, "terms_ready");

  database.setTaskStatus("supply", "owner-s1", "paused");
  service.processTask("supply");
  assert.equal(matchCaseRepository.get(created.id).status, "invalidated");
  assert.equal(taskRepository.listCandidates("renter").length, 0);
  assert.equal(taskRepository.listCandidates("supply").length, 0);
});

test("任务 input version 变化会在同一案例上标记旧评估并重算", async (t) => {
  const { database, matchCaseRepository, service } = await fixture(t, "zhunaer-case-version-");
  const draft = structuredClone(demoSupplyDraft);
  addSupply(database, { id: "supply", ownerId: "owner-s1", draft });
  service.processTask("renter");
  const before = matchCaseRepository.findByPair("renter", "supply");

  draft.title = "新版房源标题";
  database.raw.prepare("UPDATE tasks SET payload_json = ?, input_version = 2 WHERE id = 'supply'").run(
    JSON.stringify({ draft, inputVersion: 2 })
  );
  service.processTask("supply");
  const after = matchCaseRepository.findByPair("renter", "supply");
  assert.equal(after.id, before.id);
  assert.equal(after.supplyInputVersion, 2);
  assert.ok(matchCaseRepository.listEvents(after.id).some((event) => event.type === "case_recalculated"));
});
