import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";
import { createMatchCaseRepository } from "../src/server/match-case-repository.mjs";
import { evaluateTaskPair } from "../src/server/pair-evaluator.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createTaskRepository } from "../src/server/task-repository.mjs";

const at = "2026-08-30T00:00:00.000Z";
const expiresAt = "2026-09-29T00:00:00.000Z";

async function fixture(t, prefix = "zhunaer-case-repo-") {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const database = openRentalDatabase(path.join(tempDir, "rental.sqlite"));
  const tasks = createTaskRepository({ database });
  const cases = createMatchCaseRepository({ database });
  t.after(async () => {
    database.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  database.createProfile({ id: "owner-r", tokenHash: `${prefix}-r` });
  database.createProfile({ id: "owner-s", tokenHash: `${prefix}-s` });
  database.createProfile({ id: "owner-x", tokenHash: `${prefix}-x` });
  database.createTask({
    id: "renter-task",
    ownerId: "owner-r",
    kind: "renter",
    label: "静安寺",
    payload: { mandate: structuredClone(baseMandate), inputVersion: 3 },
    inputVersion: 3,
    expiresAt
  });
  database.createTask({
    id: "supply-task",
    ownerId: "owner-s",
    kind: "supply",
    label: "个人转租",
    payload: { draft: structuredClone(demoSupplyDraft), inputVersion: 5 },
    inputVersion: 5,
    expiresAt
  });
  const renterTask = tasks.get("renter-task");
  const supplyTask = tasks.get("supply-task");
  const evaluation = evaluateTaskPair({
    renterTask,
    renterInputVersion: renterTask.inputVersion,
    supplyTask,
    supplyInputVersion: supplyTask.inputVersion,
    evaluatedAt: at
  });
  return { database, tasks, cases, renterTask, supplyTask, evaluation };
}

test("案例绑定双方任务输入版本，重复创建只保留一行和一个 case_created 事件", async (t) => {
  const { cases, renterTask, supplyTask, evaluation } = await fixture(t);
  const first = cases.upsertEvaluation({ renterTask, supplyTask, evaluation, expiresAt });
  const second = cases.upsertEvaluation({ renterTask, supplyTask, evaluation, expiresAt });

  assert.equal(first.id, second.id);
  assert.equal(first.renterInputVersion, 3);
  assert.equal(first.supplyInputVersion, 5);
  assert.equal(first.status, "terms_ready");
  assert.equal(cases.list().length, 1);
  assert.equal(cases.listEvents(first.id).filter((event) => event.type === "case_created").length, 1);
});

test("非参与 owner 读取返回 null，公开条款与事件不含私密字段", async (t) => {
  const { database, cases, renterTask, supplyTask, evaluation } = await fixture(t, "zhunaer-case-privacy-");
  const created = cases.upsertEvaluation({ renterTask, supplyTask, evaluation, expiresAt });

  assert.equal(cases.getForOwner(created.id, "owner-x"), null);
  assert.equal(cases.getForOwner(created.id, "owner-r").id, created.id);
  const stored = database.raw.prepare("SELECT public_terms_json FROM match_terms WHERE match_case_id = ?").get(created.id);
  const publicStorage = `${stored.public_terms_json}${JSON.stringify(cases.listEvents(created.id))}`;
  assert.doesNotMatch(publicStorage, /hardMax|minimumAuthorizedRent|minRent|rawText|evidenceRefs|storagePath|sessionToken/);
});

test("同 owner、非 active 或私密字段进入公开条款时会被 repository 拒绝", async (t) => {
  const { database, cases, renterTask, supplyTask, evaluation } = await fixture(t, "zhunaer-case-guards-");
  database.raw.prepare("UPDATE tasks SET owner_id = 'owner-r' WHERE id = 'supply-task'").run();
  assert.throws(() => cases.upsertEvaluation({ renterTask, supplyTask: { ...supplyTask, ownerId: "owner-r" }, evaluation, expiresAt }), /same owner/);

  database.raw.prepare("UPDATE tasks SET owner_id = 'owner-s', status = 'paused' WHERE id = 'supply-task'").run();
  assert.throws(() => cases.upsertEvaluation({ renterTask, supplyTask, evaluation, expiresAt }), /active tasks/);

  database.raw.prepare("UPDATE tasks SET status = 'active' WHERE id = 'supply-task'").run();
  assert.throws(() => cases.upsertEvaluation({
    renterTask,
    supplyTask,
    evaluation: { ...evaluation, termsProposal: { ...evaluation.termsProposal, hardMax: 9_999 } },
    expiresAt
  }), /private field/);
});

test("repository 写操作可组合到外部 transaction", async (t) => {
  const { cases, renterTask, supplyTask, evaluation } = await fixture(t, "zhunaer-case-transaction-");
  const result = cases.transaction(() => cases.upsertEvaluation({ renterTask, supplyTask, evaluation, expiresAt }));
  assert.equal(result.status, "terms_ready");
  assert.equal(cases.list().length, 1);
});
