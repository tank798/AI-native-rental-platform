import assert from "node:assert/strict";
import test from "node:test";

import { baseMandate } from "../src/fixtures.mjs";
import { buildMandateFromConfirmedAnswers, seedAnswersFromParsed } from "../src/mandate-builder.mjs";
import { evaluateListing } from "../src/simulation-engine.mjs";

const aiPrefill = {
  fields: {
    city: "上海",
    locations: ["静安寺"],
    commuteDestinations: ["陆家嘴"],
    budget: { target: 3_500, hardMax: 4_000 },
    moveInWindow: { from: "2026-09-01", to: "2026-09-05" },
    maxCommuteMinutes: 30,
    leaseMonths: 12,
    sharedHousing: true,
    roommateGender: "female",
    preferences: { ensuite: "any", elevator: "any", utilities: "any" },
    facilities: { kitchen: true, washer: false }
  }
};

test("用户确认值是 builder 的唯一真值，不被 AI 预填或 demo 默认覆盖", () => {
  const seeded = seedAnswersFromParsed(aiPrefill);
  const answers = {
    ...seeded,
    budgetMin: "3000",
    budgetMax: "3300",
    commute: "25",
    leaseMonths: "6",
    moveInFrom: "2026-09-10",
    moveInTo: "2026-09-15",
    roommate: "no_share",
    kitchen: "any"
  };

  const mandate = buildMandateFromConfirmedAnswers({
    answers,
    selectedLocations: ["静安寺"],
    city: answers.city,
    baseMandate
  });

  assert.deepEqual(mandate.budget, {
    target: 3_000,
    hardMax: 3_300,
    targetIsPrivate: true,
    hardMaxIsPrivate: true
  });
  assert.equal(mandate.maxCommuteMinutes, 25);
  assert.equal(mandate.leaseMonths, 6);
  assert.equal(mandate.leaseFlexible, false);
  assert.deepEqual(mandate.moveInWindow, { from: "2026-09-10", to: "2026-09-15" });
  assert.equal(mandate.sharedHousing, false);
  assert.equal(mandate.roommateGender, null);
  assert.equal(mandate.hardConstraints.kitchen, false);
  assert.deepEqual(mandate.commuteDestinations, ["陆家嘴"]);

  const listing = {
    id: "confirmed-input-probe",
    role: "landlord",
    location: "静安寺",
    station: "静安寺站",
    district: "静安区",
    addressHint: "静安寺附近",
    commuteMinutes: 27,
    listedRent: 3_200,
    minRent: 3_200,
    availableFrom: "2026-09-10",
    leaseMonthsMin: 6,
    room: { roommateCount: 0, roommateGender: null },
    facilities: { kitchen: false, washer: true, elevator: true, ensuite: false },
    fees: { service: 0, intermediary: 0 },
    verification: { identity: "verified", role: "verified", rights: "verified", liveSite: "verified" },
    evidence: {},
    freshness: "live",
    conditionalOffers: []
  };
  const evaluated = evaluateListing(mandate, listing);
  assert.ok(evaluated.reasonCodes.includes("commute"));
  assert.ok(!evaluated.reasonCodes.includes("kitchen"));
});

test("灵活租期保留显式区间，不偷偷变成 12 个月承诺", () => {
  const mandate = buildMandateFromConfirmedAnswers({
    answers: {
      ...seedAnswersFromParsed(aiPrefill),
      leaseMonths: "any"
    },
    selectedLocations: ["静安寺"],
    city: "上海",
    baseMandate
  });

  assert.equal(mandate.leaseMonths, null);
  assert.equal(mandate.leaseFlexible, true);
  assert.deepEqual(mandate.leaseMonthsRange, { min: 3, max: 12 });
});
