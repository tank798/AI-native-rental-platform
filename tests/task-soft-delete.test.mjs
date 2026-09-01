import assert from "node:assert/strict";
import test from "node:test";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { openRentalDatabase } from "../src/server/database.mjs";

// ---------------------------------------------------------------------------
// P0 回归：被举报方不得通过删除自己的任务来销毁举报记录与双边审计痕迹。
//
// reports.match_case_id -> match_cases(id) ON DELETE CASCADE
// match_cases.renter_task_id / supply_task_id -> tasks(id) ON DELETE CASCADE
// 且 PRAGMA foreign_keys = ON。
// 因此一旦对 tasks 做物理删除，举报会连带消失。
// ---------------------------------------------------------------------------

async function withDatabase(t) {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "zhunaer-soft-delete-"));
  const repository = openRentalDatabase(path.join(tempDir, "data", "rental.sqlite"));
  t.after(async () => {
    repository.close();
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });
  return repository;
}

function seedPair(db, at) {
  const insertProfile = db.prepare("INSERT INTO profiles(id, token_hash, created_at) VALUES (?, ?, ?)");
  insertProfile.run("owner-r", "hash-owner-r", at);
  insertProfile.run("owner-s", "hash-owner-s", at);
  const insertTask = db.prepare(`
    INSERT INTO tasks(id, owner_id, kind, status, label, payload_json, input_version, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, 'active', ?, '{}', 1, ?, ?, ?)
  `);
  const expires = "2099-01-01T00:00:00.000Z";
  insertTask.run("task-renter", "owner-r", "renter", "租客任务", at, at, expires);
  insertTask.run("task-supply", "owner-s", "supply", "房源任务", at, at, expires);
  db.prepare(`
    INSERT INTO match_cases(
      id, renter_task_id, supply_task_id, status,
      renter_input_version, supply_input_version, expires_at, created_at, updated_at
    ) VALUES ('case-1', 'task-renter', 'task-supply', 'potential', 1, 1, ?, ?, ?)
  `).run(expires, at, at);
  db.prepare(`
    INSERT INTO reports(id, match_case_id, reporter_owner_id, reason_code, description, status, created_at, updated_at)
    VALUES ('report-1', 'case-1', 'owner-r', 'fraud_suspicion', '涉嫌虚假房源', 'open', ?, ?)
  `).run(at, at);
}

test("被举报方删除自己的任务后，举报记录与匹配案例必须仍然存在", async (t) => {
  const repository = await withDatabase(t);
  const db = repository.raw;
  const at = "2026-09-01T00:00:00.000Z";
  seedPair(db, at);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reports").get().n, 1);
  assert.equal(repository.countReportsForTask("task-supply"), 1, "被举报任务应能查到关联举报");

  // 被举报方（房源方）删除自己的任务
  assert.equal(repository.deleteTask("task-supply", "owner-s"), true);

  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM reports").get().n,
    1,
    "举报记录不得因对方删除任务而消失"
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM match_cases").get().n,
    1,
    "匹配案例不得被级联销毁，否则审计链断裂"
  );
  assert.equal(
    db.prepare("SELECT status FROM reports WHERE id = 'report-1'").get().status,
    "open",
    "举报应保持待处理状态"
  );
});

test("软删除会清空业务载荷并标记删除时间，同时对所有者接口隐身", async (t) => {
  const repository = await withDatabase(t);
  const db = repository.raw;
  const at = "2026-09-01T00:00:00.000Z";
  seedPair(db, at);

  repository.deleteTask("task-supply", "owner-s");

  const row = db.prepare("SELECT deleted_at, status, payload_json FROM tasks WHERE id = 'task-supply'").get();
  assert.ok(row.deleted_at, "应写入 deleted_at");
  assert.equal(row.status, "closed");
  assert.deepEqual(JSON.parse(row.payload_json).redacted, true, "业务载荷应被清空以满足删除诉求");

  // 对所有者可见性：已删除任务不得再出现在列表或单条读取中
  assert.equal(repository.getTask("task-supply"), null, "已删除任务不应可读");
  const owned = repository.listTasksForOwner("owner-s");
  assert.equal(owned.some((task) => task.id === "task-supply"), false, "已删除任务不应出现在任务列表");
});

test("重复删除同一任务不会二次生效", async (t) => {
  const repository = await withDatabase(t);
  const at = "2026-09-01T00:00:00.000Z";
  seedPair(repository.raw, at);

  assert.equal(repository.deleteTask("task-renter", "owner-r"), true);
  assert.equal(repository.deleteTask("task-renter", "owner-r"), false, "已删除任务不应再次被删除");
});

test("已删除任务不再参与匹配扫描", async (t) => {
  const repository = await withDatabase(t);
  const at = "2026-09-01T00:00:00.000Z";
  seedPair(repository.raw, at);

  const before = repository.listActiveTasks("supply");
  assert.equal(before.some((task) => task.id === "task-supply"), true);

  repository.deleteTask("task-supply", "owner-s");

  const after = repository.listActiveTasks("supply");
  assert.equal(after.some((task) => task.id === "task-supply"), false, "已删除任务不得再被扫描为候选");
});
