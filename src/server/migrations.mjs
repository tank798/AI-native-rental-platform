import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const migrationDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export const migrations = Object.freeze([
  { version: 1, name: "baseline", sqlFile: "001-baseline.sql" },
  { version: 2, name: "task-fields-and-outbox", sqlFile: "002-task-fields-and-outbox.sql" },
  { version: 3, name: "bilateral-match-cases", sqlFile: "003-bilateral-match-cases.sql" },
  { version: 4, name: "clarification-answer-spec", sqlFile: "004-clarification-answer-spec.sql" },
  { version: 5, name: "confirmation-input-versions", sqlFile: "005-confirmation-input-versions.sql" },
  { version: 6, name: "contact-grant-snapshots", sqlFile: "006-contact-grant-snapshots.sql" },
  { version: 7, name: "listing-media-metadata", sqlFile: "007-listing-media-metadata.sql" },
  { version: 8, name: "transactional-matching-worker", sqlFile: "008-transactional-matching-worker.sql" }
].map(Object.freeze));

export const latestSchemaVersion = migrations.at(-1).version;

function assertMigrationSequence(items) {
  items.forEach((migration, index) => {
    const expected = index + 1;
    if (migration.version !== expected) throw new Error(`Migration versions must be contiguous; expected ${expected}`);
    if (!/^\d{3}-[a-z0-9-]+\.sql$/u.test(migration.sqlFile)) throw new Error(`Invalid migration filename: ${migration.sqlFile}`);
  });
}

function defaultLoadSql(migration) {
  return fs.readFileSync(path.join(migrationDirectory, migration.sqlFile), "utf8");
}

/** Applies each schema version atomically and refuses databases from newer apps. */
export function runMigrations(database, { items = migrations, loadSql = defaultLoadSql } = {}) {
  assertMigrationSequence(items);
  const latest = items.at(-1)?.version || 0;
  let current = Number(database.prepare("PRAGMA user_version").get().user_version || 0);
  if (current > latest) {
    throw new Error(`Database schema version ${current} is newer than supported version ${latest}`);
  }

  for (const migration of items) {
    if (migration.version <= current) continue;
    const sql = loadSql(migration);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
      current = migration.version;
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(`Migration ${migration.version} (${migration.name}) failed`, { cause: error });
    }
  }
  return current;
}

export function migrationSqlPath(migration) {
  return path.join(migrationDirectory, migration.sqlFile);
}
