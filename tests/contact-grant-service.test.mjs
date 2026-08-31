import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createClock } from "../src/clock.mjs";
import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";
import { createConfirmationService } from "../src/server/confirmation-service.mjs";
import { createContactGrantService } from "../src/server/contact-grant-service.mjs";
import { createContactService } from "../src/server/contact-service.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createMatchCaseRepository } from "../src/server/match-case-repository.mjs";
import { createMatchCaseService } from "../src/server/match-case-service.mjs";
import { createTaskRepository } from "../src/server/task-repository.mjs";
import { testContactEncryptionKey } from "./test-secrets.mjs";

async function fixture(t) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-contact-grant-"));
  let now = "2026-08-31T00:00:00.000Z";
  const clock = createClock({ now: () => new Date(now) });
  const database = openRentalDatabase(path.join(tempDir, "rental.sqlite"), { clock });
  const taskRepository = createTaskRepository({ database, clock });
  const matchCaseRepository = createMatchCaseRepository({ database, clock });
  const contacts = createContactService({ database, encryptionKey: testContactEncryptionKey(), clock });
  const contactGrants = createContactGrantService({ database, matchCaseRepository, contactService: contacts, clock });
  const confirmations = createConfirmationService({ matchCaseRepository, contactService: contacts, contactGrantService: contactGrants, clock });
  const matchCases = createMatchCaseService({ taskRepository, matchCaseRepository, clock });
  for (const owner of ["owner-r", "owner-s", "owner-x"]) database.createProfile({ id: owner, tokenHash: `grant-${owner}` });
  database.createTask({
    id: "renter",
    ownerId: "owner-r",
    kind: "renter",
    label: "静安寺",
    payload: { mandate: structuredClone(baseMandate), inputVersion: 1 },
    inputVersion: 1,
    expiresAt: "2026-09-30T00:00:00.000Z"
  });
  database.createTask({
    id: "supply",
    ownerId: "owner-s",
    kind: "supply",
    label: "个人房源",
    payload: { draft: structuredClone(demoSupplyDraft), inputVersion: 1 },
    inputVersion: 1,
    expiresAt: "2026-09-30T00:00:00.000Z"
  });
  matchCases.processTask("renter");
  t.after(async () => {
    database.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  return {
    database,
    contacts,
    contactGrants,
    confirmations,
    matchCases,
    matchCaseRepository,
    matchCase: matchCaseRepository.findByPair("renter", "supply"),
    setNow: (value) => { now = value; }
  };
}

function termsRequest(matchCase) {
  return { matchCaseId: matchCase.id, termsVersion: matchCase.terms.version, termsHash: matchCase.terms.hash };
}

test("没有本人联系人时不能确认，且不会写入 confirmation", async (t) => {
  const { confirmations, matchCaseRepository, matchCase } = await fixture(t);
  assert.throws(
    () => confirmations.confirm({ ...termsRequest(matchCase), ownerId: "owner-r" }),
    (error) => error.status === 422 && error.code === "CONTACT_REQUIRED"
  );
  assert.equal(matchCaseRepository.listConfirmations(matchCase.id).length, 0);
});

test("单方确认仍锁定；双方同版确认后只建一个 grant 并只能读取对方联系人", async (t) => {
  const { database, contacts, contactGrants, confirmations, matchCaseRepository, matchCase } = await fixture(t);
  contacts.set("owner-r", { type: "wechat", value: "renter_2026" });
  contacts.set("owner-s", { type: "phone", value: "+8613800138000" });

  confirmations.confirm({ ...termsRequest(matchCase), ownerId: "owner-r" });
  assert.throws(() => contactGrants.getForOwner(matchCase.id, "owner-r"), (error) => error.status === 403 && error.code === "CONTACT_LOCKED");
  assert.throws(() => contactGrants.getForOwner(matchCase.id, "owner-s"), (error) => error.status === 403 && error.code === "CONTACT_LOCKED");

  confirmations.confirm({ ...termsRequest(matchCase), ownerId: "owner-s" });
  assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM contact_grants").get().count, 1);
  assert.equal(matchCaseRepository.get(matchCase.id).status, "mutually_confirmed");
  assert.equal(contactGrants.isUnlocked(matchCase.id, "owner-r"), true);
  assert.deepEqual(contactGrants.getForOwner(matchCase.id, "owner-r").contact, { type: "phone", value: "+8613800138000" });
  assert.deepEqual(contactGrants.getForOwner(matchCase.id, "owner-s").contact, { type: "wechat", value: "renter_2026" });
  assert.throws(() => contactGrants.getForOwner(matchCase.id, "owner-x"), (error) => error.status === 404);

  contactGrants.getForOwner(matchCase.id, "owner-r");
  assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM contact_grants").get().count, 1);
  const events = matchCaseRepository.listEvents(matchCase.id);
  assert.equal(events.filter((event) => event.type === "contact.granted").length, 1);
  assert.equal(events.filter((event) => event.type === "contact.viewed").length, 3);
  assert.doesNotMatch(JSON.stringify(events), /renter_2026|13800138000/u);

  contactGrants.revokeForCase(matchCase.id, "test_reauthorization");
  const renewed = confirmations.confirm({ ...termsRequest(matchCase), ownerId: "owner-r" });
  assert.equal(renewed.idempotent, true);
  assert.equal(contactGrants.isUnlocked(matchCase.id, "owner-r"), true);
  assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM contact_grants WHERE match_case_id = ?").get(matchCase.id).count, 2);
});

test("条款或任务失效会撤销 grant，旧案例 JSON 不能绕过实时门禁", async (t) => {
  const { database, contacts, contactGrants, confirmations, matchCases, matchCaseRepository, matchCase } = await fixture(t);
  contacts.set("owner-r", { type: "wechat", value: "renter_safe" });
  contacts.set("owner-s", { type: "email", value: "owner@example.com" });
  confirmations.confirm({ ...termsRequest(matchCase), ownerId: "owner-r" });
  confirmations.confirm({ ...termsRequest(matchCase), ownerId: "owner-s" });
  const staleClientCopy = structuredClone(matchCaseRepository.get(matchCase.id));
  assert.equal(contactGrants.isUnlocked(matchCase.id, "owner-r"), true);

  database.setTaskStatus("supply", "owner-s", "paused");
  matchCases.processTask("supply");
  assert.equal(staleClientCopy.terms.hash, matchCase.terms.hash);
  assert.throws(() => contactGrants.getForOwner(matchCase.id, "owner-r"), (error) => error.status === 403 && error.code === "CONTACT_LOCKED");
  const grant = database.raw.prepare("SELECT * FROM contact_grants WHERE match_case_id = ?").get(matchCase.id);
  assert.ok(grant.revoked_at);
  assert.equal(grant.revoke_reason, "task_paused");
  assert.equal(matchCaseRepository.listEvents(matchCase.id).filter((event) => event.type === "contact.revoked").length, 1);
});

test("过期 grant 会在读取时即时撤销，不能跨案例复用", async (t) => {
  const { database, contacts, contactGrants, confirmations, matchCases, matchCaseRepository, matchCase, setNow } = await fixture(t);
  contacts.set("owner-r", { type: "wechat", value: "renter_expiry" });
  contacts.set("owner-s", { type: "wechat", value: "supply_expiry" });
  confirmations.confirm({ ...termsRequest(matchCase), ownerId: "owner-r" });
  confirmations.confirm({ ...termsRequest(matchCase), ownerId: "owner-s" });
  setNow("2026-09-08T00:00:01.000Z");
  assert.throws(() => contactGrants.getForOwner(matchCase.id, "owner-r"), (error) => error.code === "CONTACT_LOCKED");
  assert.ok(database.raw.prepare("SELECT revoked_at FROM contact_grants WHERE match_case_id = ?").get(matchCase.id).revoked_at);

  database.createProfile({ id: "owner-s2", tokenHash: "grant-owner-s2" });
  database.createTask({
    id: "supply-2",
    ownerId: "owner-s2",
    kind: "supply",
    label: "第二套房",
    payload: { draft: structuredClone(demoSupplyDraft), inputVersion: 1 },
    inputVersion: 1,
    expiresAt: "2026-09-30T00:00:00.000Z"
  });
  contacts.set("owner-s2", { type: "email", value: "second-case@example.com" });
  matchCases.processTask("supply-2");
  const secondCase = matchCaseRepository.findByPair("renter", "supply-2");
  assert.ok(secondCase);
  confirmations.confirm({ ...termsRequest(secondCase), ownerId: "owner-r" });
  confirmations.confirm({ ...termsRequest(secondCase), ownerId: "owner-s2" });
  assert.deepEqual(contactGrants.getForOwner(secondCase.id, "owner-r").contact, { type: "email", value: "second-case@example.com" });
  assert.throws(() => contactGrants.getForOwner(secondCase.id, "owner-s"), (error) => error.status === 404);
  assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM contact_grants").get().count, 2);
  assert.throws(() => contactGrants.getForOwner("missing-case", "owner-r"), (error) => error.status === 404);
});
