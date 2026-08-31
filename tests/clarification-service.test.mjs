import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createClock } from "../src/clock.mjs";
import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";
import { createClarificationService, selectClarificationQuestions } from "../src/server/clarification-service.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createMatchCaseRepository } from "../src/server/match-case-repository.mjs";
import { createMatchingService } from "../src/server/matching-service.mjs";
import { createTaskRepository } from "../src/server/task-repository.mjs";
import { testContactEncryptionKey } from "./test-secrets.mjs";

const expiresAt = "2026-09-29T00:00:00.000Z";

test("五个未知项每轮只选三个，按安全、硬条件、价格租期费用排序并指向正确 party", () => {
  const questions = selectClarificationQuestions({
    blockingUnknowns: [
      { fieldKey: "listing.facilities.exposure", targetParty: "supply", reasonCode: "PREFERENCE_UNKNOWN", label: "朝向待确认" },
      { fieldKey: "listing.roommateGender", targetParty: "supply", reasonCode: "ROOMMATE_GENDER_UNKNOWN", label: "室友待确认" },
      { fieldKey: "listing.fees.utilities", targetParty: "supply", reasonCode: "TOTAL_COST_BLOCKING_UNKNOWN", label: "费用待确认" },
      { fieldKey: "listing.facilities.kitchen", targetParty: "supply", reasonCode: "REQUIRED_FACILITY_UNKNOWN", label: "厨房待确认" },
      { fieldKey: "listing.rights", targetParty: "supply", reasonCode: "RIGHTS_VERIFICATION_UNKNOWN", label: "出租权待确认" }
    ]
  });
  assert.equal(questions.length, 3);
  assert.deepEqual(questions.map((item) => item.priority), [100, 90, 80]);
  assert.equal(questions.every((item) => item.targetParty === "supply"), true);
  assert.doesNotMatch(JSON.stringify(questions), /底价|最高预算|rawText|hardMax/);
});

async function fixture(t, prefix = "zhunaer-clarification-") {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const clock = createClock({ now: () => new Date("2026-08-30T00:00:00.000Z") });
  const database = openRentalDatabase(path.join(tempDir, "rental.sqlite"), { clock });
  const matching = createMatchingService(database, { clock, marketMode: "real", contactEncryptionKey: testContactEncryptionKey() });
  t.after(async () => {
    database.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  for (const owner of ["owner-r", "owner-s", "owner-x"]) database.createProfile({ id: owner, tokenHash: `${prefix}-${owner}` });
  database.createTask({
    id: "renter",
    ownerId: "owner-r",
    kind: "renter",
    label: "静安寺",
    payload: { mandate: structuredClone(baseMandate), inputVersion: 1 },
    inputVersion: 1,
    expiresAt
  });
  const draft = structuredClone(demoSupplyDraft);
  draft.facilities.kitchen = null;
  database.createTask({
    id: "supply",
    ownerId: "owner-s",
    kind: "supply",
    label: "厨房待确认",
    payload: { draft, inputVersion: 1 },
    inputVersion: 1,
    expiresAt
  });
  matching.processAfterTaskCreated("supply");
  return { database, matching, clock };
}

test("同一 open field 不重复建问题，已回答和用户已确认字段不再追问", async (t) => {
  const { database, matching } = await fixture(t, "zhunaer-clarification-dedupe-");
  const matchCase = matching.matchCaseRepository.findByPair("renter", "supply");
  assert.equal(matching.matchCaseRepository.listClarifications(matchCase.id).filter((item) => item.status === "open").length, 1);
  matching.processTask("supply");
  assert.equal(matching.matchCaseRepository.listClarifications(matchCase.id).filter((item) => item.status === "open").length, 1);

  database.raw.prepare(`
    INSERT INTO task_fields(task_id, field_key, value_json, source, confidence, confirmation_status, visibility, version, updated_at)
    VALUES ('supply', 'listing.facilities.kitchen', 'true', 'user_confirmed', 1, 'confirmed', 'market_public', 1, '2026-08-30T00:00:00.000Z')
    ON CONFLICT(task_id, field_key) DO UPDATE SET source = 'user_confirmed', confirmation_status = 'confirmed'
  `).run();
  const service = createClarificationService({
    taskRepository: createTaskRepository({ database }),
    matchCaseRepository: createMatchCaseRepository({ database })
  });
  const selected = service.selectQuestions(matchCase, {
    status: "clarifying",
    blockingUnknowns: [{ fieldKey: "listing.facilities.kitchen", targetParty: "supply", reasonCode: "REQUIRED_FACILITY_UNKNOWN", label: "厨房待确认" }]
  }, { renter: matching.taskRepository.get("renter"), supply: matching.taskRepository.get("supply") });
  assert.equal(selected.length, 0);
});

test("非目标方 404；回答经 schema 后原子写字段版本、outbox 和事件，随后自动进入 terms_ready", async (t) => {
  const { database, matching } = await fixture(t, "zhunaer-clarification-answer-");
  const matchCase = matching.matchCaseRepository.findByPair("renter", "supply");
  const request = matching.matchCaseRepository.listClarifications(matchCase.id).find((item) => item.status === "open");
  await assert.rejects(
    matching.clarifications.answer({ matchCaseId: matchCase.id, clarificationId: request.id, ownerId: "owner-r", rawAnswer: true }),
    (error) => error.status === 404
  );
  await assert.rejects(
    matching.clarifications.answer({ matchCaseId: matchCase.id, clarificationId: request.id, ownerId: "owner-s", rawAnswer: "maybe" }),
    (error) => error.status === 422
  );

  const answered = await matching.clarifications.answer({
    matchCaseId: matchCase.id,
    clarificationId: request.id,
    ownerId: "owner-s",
    rawAnswer: true
  });
  assert.equal(answered.field.source, "counterparty_answer");
  assert.equal(answered.field.version, 1);
  assert.equal(answered.task.inputVersion, 2);
  assert.equal(matching.matchCaseRepository.get(matchCase.id).status, "terms_ready");
  assert.equal(database.raw.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_id = 'supply'").get().count, 1);
  assert.equal(matching.matchCaseRepository.listEvents(matchCase.id).filter((event) => event.type === "clarification_answered").length, 1);

  const replay = await matching.clarifications.answer({
    matchCaseId: matchCase.id,
    clarificationId: request.id,
    ownerId: "owner-s",
    rawAnswer: true
  });
  assert.equal(replay.idempotent, true);
  await assert.rejects(
    matching.clarifications.answer({ matchCaseId: matchCase.id, clarificationId: request.id, ownerId: "owner-s", rawAnswer: false }),
    (error) => error.status === 409
  );
});

test("模型不可用时诚实回退到规则问题，case 仍可继续", async (t) => {
  const { database, matching } = await fixture(t, "zhunaer-clarification-fallback-");
  const matchCase = matching.matchCaseRepository.findByPair("renter", "supply");
  const taskRepository = createTaskRepository({ database });
  const matchCaseRepository = createMatchCaseRepository({ database });
  const service = createClarificationService({
    taskRepository,
    matchCaseRepository,
    questionGenerator: async () => { throw new Error("provider unavailable"); }
  });
  const evaluation = matching.matchCases.processPair(taskRepository.get("renter"), taskRepository.get("supply")).evaluation;
  await service.syncForCaseWithModel({
    matchCase,
    evaluation,
    renterTask: taskRepository.get("renter"),
    supplyTask: taskRepository.get("supply")
  });
  const open = matchCaseRepository.listClarifications(matchCase.id).find((item) => item.status === "open");
  assert.equal(open.answerSpec.provider, "rule_fallback");
  assert.equal(matchCaseRepository.get(matchCase.id).status, "clarifying");
});
