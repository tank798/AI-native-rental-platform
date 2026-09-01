import assert from "node:assert/strict";
import test from "node:test";

import { createClock } from "../src/clock.mjs";
import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";
import { createConfirmationService } from "../src/server/confirmation-service.mjs";
import { createContactGrantService } from "../src/server/contact-grant-service.mjs";
import { createContactService } from "../src/server/contact-service.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createEventService } from "../src/server/event-service.mjs";
import { createMatchCaseRepository } from "../src/server/match-case-repository.mjs";
import { createMatchCaseService } from "../src/server/match-case-service.mjs";
import { createTaskRepository } from "../src/server/task-repository.mjs";
import { createViewingService } from "../src/server/viewing-service.mjs";
import { testContactEncryptionKey } from "./test-secrets.mjs";

function fixture(t) {
  const clock = createClock({ now: () => new Date("2026-08-31T00:00:00.000Z") });
  const database = openRentalDatabase(":memory:", { clock });
  t.after(() => database.close());
  const taskRepository = createTaskRepository({ database, clock });
  const matchCaseRepository = createMatchCaseRepository({ database, clock });
  const matchCases = createMatchCaseService({ taskRepository, matchCaseRepository, clock });
  const contacts = createContactService({ database, encryptionKey: testContactEncryptionKey(), clock });
  const contactGrants = createContactGrantService({ database, matchCaseRepository, contactService: contacts, clock });
  const confirmations = createConfirmationService({ matchCaseRepository, contactService: contacts, contactGrantService: contactGrants, clock });
  for (const owner of ["owner-r", "owner-s", "outsider"]) database.createProfile({ id: owner, tokenHash: `viewing-${owner}` });
  contacts.set("owner-r", { type: "wechat", value: "renter_viewing" });
  contacts.set("owner-s", { type: "wechat", value: "supply_viewing" });
  database.createTask({ id: "renter", ownerId: "owner-r", kind: "renter", label: "找房", payload: { mandate: structuredClone(baseMandate) }, expiresAt: "2026-09-14T00:00:00.000Z" });
  database.createTask({ id: "supply", ownerId: "owner-s", kind: "supply", label: "房源", payload: { draft: structuredClone(demoSupplyDraft) }, expiresAt: "2026-09-14T00:00:00.000Z" });
  matchCases.processTask("renter");
  const matchCase = matchCaseRepository.findByPair("renter", "supply");
  const request = { matchCaseId: matchCase.id, termsVersion: matchCase.terms.version, termsHash: matchCase.terms.hash };
  const viewings = createViewingService({ database, matchCaseRepository, contactGrantService: contactGrants, eventService: createEventService({ database, clock }), clock });
  return { database, confirmations, contactGrants, matchCase, request, viewings };
}

test("单方确认时不能提议看房，授权后可提出且只能由对方回应", (t) => {
  const { confirmations, matchCase, request, viewings } = fixture(t);
  confirmations.confirm({ ...request, ownerId: "owner-r" });
  assert.throws(() => viewings.propose({ matchCaseId: matchCase.id, ownerId: "owner-r", startsAt: "2026-09-02T10:00:00.000Z" }), (error) => error.code === "VIEWING_GRANT_REQUIRED");
  confirmations.confirm({ ...request, ownerId: "owner-s" });
  const proposed = viewings.propose({ matchCaseId: matchCase.id, ownerId: "owner-r", startsAt: "2026-09-02T10:00:00.000Z" });
  assert.equal(proposed.appointment.status, "proposed");
  assert.equal(viewings.propose({ matchCaseId: matchCase.id, ownerId: "owner-r", startsAt: "2026-09-03T10:00:00.000Z" }).idempotent, true);
  assert.throws(() => viewings.respond({ appointmentId: proposed.appointment.id, ownerId: "owner-r", decision: "accepted" }), (error) => error.code === "VIEWING_SELF_RESPONSE");
  assert.equal(viewings.respond({ appointmentId: proposed.appointment.id, ownerId: "owner-s", decision: "accepted" }).appointment.status, "accepted");
});

test("任务暂停会使未完成看房提议取消", (t) => {
  const { database, confirmations, contactGrants, matchCase, request, viewings } = fixture(t);
  confirmations.confirm({ ...request, ownerId: "owner-r" });
  confirmations.confirm({ ...request, ownerId: "owner-s" });
  const proposed = viewings.propose({ matchCaseId: matchCase.id, ownerId: "owner-r", startsAt: "2026-09-02T10:00:00.000Z" });
  database.setTaskStatus("supply", "owner-s", "paused");
  contactGrants.revokeForCase(matchCase.id, "task_paused");
  assert.equal(viewings.cancelInvalid(), 1);
  assert.equal(viewings.listForCase(matchCase.id, "owner-r")[0].id, proposed.appointment.id);
  assert.equal(viewings.listForCase(matchCase.id, "owner-r")[0].status, "cancelled");
});
