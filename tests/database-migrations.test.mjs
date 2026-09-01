import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { openRentalDatabase } from "../src/server/database.mjs";
import {
  latestSchemaVersion,
  migrationSqlPath,
  migrations,
  runMigrations
} from "../src/server/migrations.mjs";

function createLegacyFixture(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE profiles (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES profiles(id),
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      label TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      scanned INTEGER NOT NULL DEFAULT 0,
      suitable INTEGER NOT NULL DEFAULT 0,
      run_count INTEGER NOT NULL DEFAULT 0,
      candidate_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_match_at TEXT,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE match_candidates (
      id TEXT PRIMARY KEY,
      receiver_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      counterparty_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(receiver_task_id, counterparty_id)
    );
    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const at = "2026-08-30T00:00:00.000Z";
  db.prepare("INSERT INTO profiles VALUES (?, ?, ?)").run("owner-r", "legacy-r", at);
  db.prepare("INSERT INTO profiles VALUES (?, ?, ?)").run("owner-s", "legacy-s", at);
  const insertTask = db.prepare(`
    INSERT INTO tasks(id, owner_id, kind, status, label, payload_json, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `);
  insertTask.run("renter-legacy", "owner-r", "renter", "静安寺找房", JSON.stringify({
    rawText: "静安寺找房，9 月 3 日入住",
    inputVersion: 2,
    mandate: { locations: ["静安寺"], moveInWindow: { from: "2026-09-03", to: "2026-09-08" } }
  }), at, at, "2026-09-29T00:00:00.000Z");
  insertTask.run("supply-legacy", "owner-s", "supply", "个人转租", JSON.stringify({
    rawText: "个人转租",
    evidenceRefs: { identity: "evidence-中文", rightsDocument: "rights-2026-09-03" },
    draft: { location: "静安寺", availableFrom: "2026-09-03" }
  }), at, at, "2026-09-29T00:00:00.000Z");
  db.prepare("INSERT INTO match_candidates VALUES (?, ?, ?, ?, ?, ?)").run(
    "candidate-1",
    "renter-legacy",
    "supply-legacy",
    JSON.stringify({ label: "旧库中文候选" }),
    at,
    at
  );
  db.prepare("INSERT INTO audit_events(task_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)").run(
    "renter-legacy",
    "candidate.set_changed",
    JSON.stringify({ note: "事件不能丢" }),
    at
  );
  db.close();
}

test("迁移列表版本连续且 SQL 文件全部入库", () => {
  assert.deepEqual(migrations.map((item) => item.version), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(latestSchemaVersion, 9);
  migrations.forEach((migration) => assert.equal(fs.statSync(migrationSqlPath(migration)).isFile(), true));
});

test("全新数据库迁移到最新版本并强制连接与文件安全参数", async (t) => {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "zhunaer-migrations-new-"));
  const filename = path.join(tempDir, "data", "rental.sqlite");
  const repository = openRentalDatabase(filename);
  t.after(async () => {
    repository.close();
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  assert.equal(repository.raw.prepare("PRAGMA user_version").get().user_version, latestSchemaVersion);
  assert.equal(repository.raw.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.equal(repository.raw.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(repository.raw.prepare("PRAGMA busy_timeout").get().timeout, 5_000);
  assert.equal(fs.statSync(path.dirname(filename)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
});

test("v0.6 中文数据、候选和事件在迁移后完整保留，重复打开不重放", async (t) => {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "zhunaer-migrations-legacy-"));
  const filename = path.join(tempDir, "legacy.sqlite");
  createLegacyFixture(filename);
  let repository = openRentalDatabase(filename);
  const backupPath = repository.migrationBackupPath;

  assert.equal(repository.getTask("renter-legacy").label, "静安寺找房");
  assert.equal(repository.getTask("renter-legacy").inputVersion, 2);
  assert.equal(repository.getTask("supply-legacy").payload.evidenceRefs.identity, "evidence-中文");
  assert.equal(repository.listCandidates("renter-legacy")[0].payload.label, "旧库中文候选");
  assert.equal(repository.listEvents("renter-legacy")[0].payload.note, "事件不能丢");
  assert.ok(backupPath && fs.existsSync(backupPath));
  assert.equal(fs.statSync(backupPath).mode & 0o777, 0o600);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  assert.equal(backup.prepare("PRAGMA user_version").get().user_version, 0);
  assert.equal(backup.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 2);
  backup.close();

  repository.close();
  repository = openRentalDatabase(filename);
  assert.equal(repository.migrationBackupPath, null);
  assert.equal(repository.raw.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 2);
  t.after(async () => {
    repository.close();
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });
});

test("失败迁移整体回滚且 user_version 不前进", () => {
  const database = new DatabaseSync(":memory:");
  const items = [
    { version: 1, name: "ok", sqlFile: "001-ok.sql" },
    { version: 2, name: "broken", sqlFile: "002-broken.sql" }
  ];
  assert.throws(() => runMigrations(database, {
    items,
    loadSql: (migration) => migration.version === 1
      ? "CREATE TABLE stable(id TEXT PRIMARY KEY);"
      : "CREATE TABLE should_rollback(id TEXT); INVALID SQL;"
  }), /Migration 2/);
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'should_rollback'").get().count, 0);
  database.close();
});

test("新版本数据库会拒绝被旧程序打开", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA user_version = 99");
  assert.throws(() => runMigrations(database), /newer than supported/);
  database.close();
});

test("双边案例、open 澄清、确认和 outbox 去重均由数据库约束", async (t) => {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "zhunaer-migrations-constraints-"));
  const repository = openRentalDatabase(path.join(tempDir, "rental.sqlite"));
  t.after(async () => {
    repository.close();
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });
  repository.createProfile({ id: "owner-r", tokenHash: "constraint-r" });
  repository.createProfile({ id: "owner-s", tokenHash: "constraint-s" });
  repository.createTask({ id: "renter", ownerId: "owner-r", kind: "renter", label: "r", payload: {}, expiresAt: "2026-10-01T00:00:00.000Z" });
  repository.createTask({ id: "supply", ownerId: "owner-s", kind: "supply", label: "s", payload: {}, expiresAt: "2026-10-01T00:00:00.000Z" });
  const at = "2026-08-30T00:00:00.000Z";
  const insertCase = repository.raw.prepare(`
    INSERT INTO match_cases(id, renter_task_id, supply_task_id, status, renter_input_version, supply_input_version, expires_at, created_at, updated_at)
    VALUES (?, 'renter', 'supply', 'potential', 1, 1, '2026-10-01T00:00:00.000Z', ?, ?)
  `);
  insertCase.run("case-1", at, at);
  assert.throws(() => insertCase.run("case-2", at, at), /UNIQUE/);

  const insertClarification = repository.raw.prepare(`
    INSERT INTO clarification_requests(id, match_case_id, target_party, field_key, question, reason_code, priority, status, created_at)
    VALUES (?, 'case-1', 'supply', 'fees.utilities', '水电怎么收？', 'TOTAL_COST_UNKNOWN', 80, 'open', ?)
  `);
  insertClarification.run("clarification-1", at);
  assert.throws(() => insertClarification.run("clarification-2", at), /UNIQUE/);

  const insertConfirmation = repository.raw.prepare(`
    INSERT INTO party_confirmations(id, match_case_id, party, owner_id, terms_version, terms_hash,
                                    renter_input_version, supply_input_version, decision, confirmed_at)
    VALUES (?, 'case-1', 'renter', 'owner-r', 1, 'hash-1', 1, 1, 'confirmed', ?)
  `);
  insertConfirmation.run("confirmation-1", at);
  assert.throws(() => insertConfirmation.run("confirmation-2", at), /UNIQUE/);

  repository.raw.prepare(`
    INSERT INTO match_terms(match_case_id, version, terms_hash, public_terms_json, blocking_unknowns_json,
                            non_blocking_unknowns_json, created_at)
    VALUES ('case-1', 1, 'hash-1', '{}', '[]', '[]', ?)
  `).run(at);
  const insertGrant = repository.raw.prepare(`
    INSERT INTO contact_grants(id, match_case_id, terms_version, terms_hash, renter_input_version,
                               supply_input_version, renter_owner_id, supply_owner_id, granted_at, expires_at)
    VALUES (?, 'case-1', 1, 'hash-1', 1, 1, 'owner-r', 'owner-s', ?, '2026-09-30T00:00:00.000Z')
  `);
  insertGrant.run("grant-1", at);
  assert.throws(() => insertGrant.run("grant-2", at), /UNIQUE/);
  repository.raw.prepare("UPDATE contact_grants SET revoked_at = ?, revoke_reason = 'test' WHERE id = 'grant-1'").run(at);
  insertGrant.run("grant-2", at);

  const insertOutbox = repository.raw.prepare(`
    INSERT INTO outbox_events(id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key, status, available_at, created_at)
    VALUES (?, 'task', 'renter', 'task.match_requested', '{}', 'constraint:renter:input:1', 'pending', ?, ?)
  `);
  insertOutbox.run("outbox-1", at, at);
  assert.throws(() => insertOutbox.run("outbox-2", at, at), /UNIQUE/);
  assert.throws(() => repository.raw.prepare(`
    INSERT INTO tasks(id, owner_id, kind, status, label, payload_json, created_at, updated_at, expires_at)
    VALUES ('bad-task', 'missing-owner', 'renter', 'active', 'bad', '{}', ?, ?, ?)
  `).run(at, at, at), /FOREIGN KEY/);
});

test("SQLite 写锁返回稳定 busy 错误，释放后同一写入可安全重试", async (t) => {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "zhunaer-sqlite-busy-"));
  const databasePath = path.join(tempDir, "busy.sqlite");
  const holder = new DatabaseSync(databasePath);
  const writer = new DatabaseSync(databasePath);
  t.after(async () => {
    try { holder.exec("ROLLBACK"); } catch {}
    holder.close();
    writer.close();
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  holder.exec("CREATE TABLE writes(id TEXT PRIMARY KEY, value TEXT NOT NULL); BEGIN IMMEDIATE;");
  holder.prepare("INSERT INTO writes(id, value) VALUES (?, ?)").run("holder", "in-flight");
  writer.exec("PRAGMA busy_timeout = 1");
  assert.throws(
    () => writer.prepare("INSERT INTO writes(id, value) VALUES (?, ?)").run("retry-key", "first-attempt"),
    (error) => error.code === "ERR_SQLITE_ERROR" && /locked|busy/u.test(error.message)
  );

  holder.exec("COMMIT");
  writer.prepare("INSERT INTO writes(id, value) VALUES (?, ?)").run("retry-key", "retried");
  const retried = writer.prepare("SELECT id, value FROM writes WHERE id = ?").get("retry-key");
  assert.equal(retried.id, "retry-key");
  assert.equal(retried.value, "retried");
});
