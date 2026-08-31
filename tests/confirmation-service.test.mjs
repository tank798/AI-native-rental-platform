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
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-confirmation-"));
  const clock = createClock({ now: () => new Date("2026-08-31T00:00:00.000Z") });
  const database = openRentalDatabase(path.join(tempDir, "rental.sqlite"), { clock });
  const taskRepository = createTaskRepository({ database, clock });
  const matchCaseRepository = createMatchCaseRepository({ database, clock });
  const matchCases = createMatchCaseService({ taskRepository, matchCaseRepository, clock });
  const contacts = createContactService({ database, encryptionKey: testContactEncryptionKey(), clock });
  const contactGrants = createContactGrantService({ database, matchCaseRepository, contactService: contacts, clock });
  const confirmations = createConfirmationService({ matchCaseRepository, contactService: contacts, contactGrantService: contactGrants, clock });
  t.after(async () => {
    database.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  for (const owner of ["owner-r", "owner-s", "owner-x"]) database.createProfile({ id: owner, tokenHash: `token-${owner}` });
  contacts.set("owner-r", { type: "wechat", value: "renter-confirmation" });
  contacts.set("owner-s", { type: "wechat", value: "supply-confirmation" });
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
  return { database, taskRepository, matchCaseRepository, matchCases, confirmations, matchCase: matchCaseRepository.findByPair("renter", "supply") };
}

test("双方只有确认同一 version/hash 才 mutually_confirmed，相同请求和重复调度幂等", async (t) => {
  const { confirmations, matchCaseRepository, matchCases, matchCase } = await fixture(t);
  const request = { matchCaseId: matchCase.id, termsVersion: matchCase.terms.version, termsHash: matchCase.terms.hash };
  const first = confirmations.confirm({ ...request, ownerId: "owner-r" });
  assert.equal(first.matchCase.status, "awaiting_confirmations");
  assert.equal(first.myDecision, "confirmed");
  assert.equal(first.otherDecision, "pending");

  const replay = confirmations.confirm({ ...request, ownerId: "owner-r" });
  assert.equal(replay.idempotent, true);
  assert.equal(matchCaseRepository.listEvents(matchCase.id).filter((event) => event.type === "party_confirmed").length, 1);

  const second = confirmations.confirm({ ...request, ownerId: "owner-s" });
  assert.equal(second.matchCase.status, "mutually_confirmed");
  assert.equal(second.myDecision, "confirmed");
  assert.equal(second.otherDecision, "confirmed");
  matchCases.processTask("renter");
  assert.equal(matchCaseRepository.get(matchCase.id).status, "mutually_confirmed");
  assert.doesNotMatch(
    JSON.stringify({ confirmations: matchCaseRepository.listConfirmations(matchCase.id), events: matchCaseRepository.listEvents(matchCase.id) }),
    /renter-confirmation|supply-confirmation|hardMax|minimumAuthorizedRent/u
  );
});

test("过期 version/hash 返回 409，第三方返回 404", async (t) => {
  const { confirmations, matchCase } = await fixture(t);
  assert.throws(
    () => confirmations.confirm({ matchCaseId: matchCase.id, ownerId: "owner-x", termsVersion: matchCase.terms.version, termsHash: matchCase.terms.hash }),
    (error) => error.status === 404
  );
  assert.throws(
    () => confirmations.confirm({ matchCaseId: matchCase.id, ownerId: "owner-r", termsVersion: 99, termsHash: matchCase.terms.hash }),
    (error) => error.status === 409
  );
  assert.throws(
    () => confirmations.confirm({ matchCaseId: matchCase.id, ownerId: "owner-r", termsVersion: matchCase.terms.version, termsHash: "sha256:stale" }),
    (error) => error.status === 409
  );
});

test("任一方拒绝后该版本不能继续确认", async (t) => {
  const { confirmations, matchCase } = await fixture(t);
  const request = { matchCaseId: matchCase.id, termsVersion: matchCase.terms.version, termsHash: matchCase.terms.hash };
  const declined = confirmations.decline({ ...request, ownerId: "owner-r" });
  assert.equal(declined.matchCase.status, "declined");
  assert.throws(() => confirmations.confirm({ ...request, ownerId: "owner-s" }), (error) => error.status === 409);
  const replay = confirmations.decline({ ...request, ownerId: "owner-r" });
  assert.equal(replay.idempotent, true);
});

test("条款或任务输入版本变化会撤销旧确认", async (t) => {
  const { database, confirmations, matchCaseRepository, matchCases, matchCase } = await fixture(t);
  confirmations.confirm({
    matchCaseId: matchCase.id,
    ownerId: "owner-r",
    termsVersion: matchCase.terms.version,
    termsHash: matchCase.terms.hash
  });
  const task = database.getTask("supply");
  const changed = structuredClone(task.payload);
  changed.draft.viewingAvailability = "weekend";
  database.raw.prepare("UPDATE tasks SET payload_json = ?, input_version = 2 WHERE id = 'supply'").run(JSON.stringify(changed));
  matchCases.processTask("supply");

  const next = matchCaseRepository.get(matchCase.id);
  assert.equal(next.status, "terms_ready");
  assert.notEqual(next.terms.hash, matchCase.terms.hash);
  assert.ok(matchCaseRepository.listConfirmations(matchCase.id).every((item) => item.revokedAt));

  confirmations.confirm({ matchCaseId: next.id, ownerId: "owner-r", termsVersion: next.terms.version, termsHash: next.terms.hash });
  const sameTermsPayload = structuredClone(database.getTask("supply").payload);
  sameTermsPayload.draft.title = "只改私有任务标题";
  database.raw.prepare("UPDATE tasks SET payload_json = ?, input_version = 3 WHERE id = 'supply'").run(JSON.stringify(sameTermsPayload));
  matchCases.processTask("supply");
  const sameTermsNextInput = matchCaseRepository.get(matchCase.id);
  assert.equal(sameTermsNextInput.terms.hash, next.terms.hash);
  assert.equal(sameTermsNextInput.status, "terms_ready");
  assert.ok(matchCaseRepository.listConfirmations(matchCase.id).filter((item) => item.termsVersion === next.terms.version).every((item) => item.revokedAt));
});
