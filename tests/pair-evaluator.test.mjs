import assert from "node:assert/strict";
import test from "node:test";

import { baseMandate, demoSupplyDraft } from "../src/fixtures.mjs";
import { evaluateTaskPair } from "../src/server/pair-evaluator.mjs";

const evaluatedAt = "2026-08-30T00:00:00.000Z";

function pair({ mandate = {}, draft = {} } = {}) {
  const renterTask = {
    id: "renter-001",
    ownerId: "owner-r",
    kind: "renter",
    payload: { mandate: { ...structuredClone(baseMandate), ...structuredClone(mandate) } }
  };
  const supplyTask = {
    id: "supply-001",
    ownerId: "owner-s",
    kind: "supply",
    payload: { draft: { ...structuredClone(demoSupplyDraft), ...structuredClone(draft) } }
  };
  return { renterTask, renterInputVersion: 3, supplyTask, supplyInputVersion: 5, evaluatedAt };
}

function evaluate(overrides) {
  return evaluateTaskPair(pair(overrides));
}

test("城市、价格、租期、日期和整租冲突都是确定性硬冲突", () => {
  const cases = [
    [{ mandate: { city: "北京" } }, "CITY_MISMATCH"],
    [{ mandate: { budget: { target: 2500, hardMax: 2999 } } }, "PRICE_NO_INTERSECTION"],
    [{ mandate: { leaseMonths: 6 }, draft: { leaseMonthsMin: 12 } }, "LEASE_NO_INTERSECTION"],
    [{ mandate: { moveInWindow: { from: "2026-09-01", to: "2026-09-02" } }, draft: { availableFrom: "2026-09-03" } }, "MOVE_IN_NO_INTERSECTION"],
    [{ mandate: { sharedHousing: false }, draft: { roommateCount: 1 } }, "HOUSING_MODE_MISMATCH"]
  ];
  for (const [overrides, code] of cases) {
    const result = evaluate(overrides);
    assert.equal(result.status, "hard_conflict", code);
    assert.ok(result.hardConflicts.some((item) => item.code === code), code);
    assert.equal(result.termsProposal, null, code);
  }
});

test("居住区域与通勤目的地分离，路线符合上限时通过", () => {
  const result = evaluate({
    mandate: {
      locations: ["静安寺"],
      commuteDestinations: ["陆家嘴"],
      maxCommuteMinutes: 25,
      preferences: { exposure: "any" }
    },
    draft: { location: "静安寺", commuteMinutesByDestination: { "陆家嘴": 24 } }
  });
  assert.equal(result.status, "eligible");
  assert.ok(result.publicReasons.includes("居住区域符合"));
  assert.ok(result.publicReasons.includes("通勤时间符合"));
});

test("必须设施和总成本未知会定向阻断，不猜 true", () => {
  const result = evaluate({
    mandate: {
      budget: { target: 3300, hardMax: 3300 },
      hardConstraints: { ...baseMandate.hardConstraints, kitchen: true, washer: true },
      preferences: { exposure: "any" }
    },
    draft: {
      listedRent: 3250,
      minimumAuthorizedRent: 3200,
      facilities: { ...demoSupplyDraft.facilities, kitchen: null, washer: null },
      fees: { ...demoSupplyDraft.fees, utilities: null }
    }
  });
  assert.equal(result.status, "clarifying");
  assert.ok(result.blockingUnknowns.some((item) => item.fieldKey === "listing.facilities.kitchen" && item.targetParty === "supply"));
  assert.ok(result.blockingUnknowns.some((item) => item.reasonCode === "TOTAL_COST_BLOCKING_UNKNOWN"));
});

test("只不满足朝向偏好仍 eligible，但评分下降", () => {
  const preferred = evaluate({ mandate: { preferences: { exposure: "south_preferred" } }, draft: { facilities: { ...demoSupplyDraft.facilities, exposure: "south" } } });
  const mismatched = evaluate({ mandate: { preferences: { exposure: "south_preferred" } }, draft: { facilities: { ...demoSupplyDraft.facilities, exposure: "north" } } });
  assert.equal(mismatched.status, "eligible");
  assert.ok(mismatched.score < preferred.score);
});

test("公开理由、条款和双视角投影不泄露预算上限、底价、精确地址或原文", () => {
  const result = evaluate({ mandate: { budget: { target: 2500, hardMax: 2999 } } });
  const publicPayload = JSON.stringify({
    publicReasons: result.publicReasons,
    terms: result.termsProposal,
    renter: result.renterCandidateProjection,
    supply: result.supplyCandidateProjection
  });
  assert.doesNotMatch(publicPayload, /hardMax|minimumAuthorizedRent|minRent|rawText|evidenceRefs|南阳路（/);
  assert.match(JSON.stringify(result.privateDiagnostics), /hard max|minimum/i);
});

test("相同输入版本与 evaluatedAt 生成完全相同的规范化输出", () => {
  assert.deepEqual(evaluate(), evaluate());
});
