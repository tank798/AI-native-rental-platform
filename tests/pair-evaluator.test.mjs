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

// ---------------------------------------------------------------------------
// P0 回归：对外披露的价格绝不能等于（或可反推出）租客的私密上限 hardMax。
// 旧实现 Math.max(min, Math.min(listed, hardMax)) 在 hardMax < listedRent 时
// 使提案价恒等于 hardMax，房东只要看到提案价低于自己的挂牌价即可反推出租客底牌。
// ---------------------------------------------------------------------------

test("P0：hardMax 低于挂牌价时不得直接对外给出提案价，必须先要求房东自主让价", () => {
  const result = evaluate({
    mandate: { budget: { target: 3000, hardMax: 3100 } },
    draft: { listedRent: 3800, minimumAuthorizedRent: 3000, concessionRent: null }
  });
  assert.equal(result.termsProposal?.rent ?? null, null, "未取得房东让价前不得产出提案价");
  assert.equal(result.status, "clarifying");
  const ask = result.blockingUnknowns.find((item) => item.reasonCode === "RENT_CONCESSION_REQUIRED");
  assert.ok(ask, "必须向房东发起让价确认");
  assert.equal(ask.targetParty, "supply", "让价只能问房东，不能问租客");
});

test("P0：提案价只能来自房东自己的数字（挂牌价或让价），不得等于租客私密上限", () => {
  // 覆盖多组价格组合，逐一验证隐私不变量
  const combos = [
    { min: 3000, listed: 3800, hardMax: 3400, concession: 3200 },
    { min: 3000, listed: 3800, hardMax: 3400, concession: 3400 },
    { min: 5000, listed: 8000, hardMax: 6200, concession: 5500 },
    { min: 3000, listed: 3800, hardMax: 4500, concession: null },
    { min: 3000, listed: 3800, hardMax: 3800, concession: null }
  ];
  for (const combo of combos) {
    const result = evaluate({
      mandate: { budget: { target: combo.min, hardMax: combo.hardMax } },
      draft: {
        listedRent: combo.listed,
        minimumAuthorizedRent: combo.min,
        concessionRent: combo.concession,
        fees: { ...structuredClone(demoSupplyDraft.fees), rent: combo.listed }
      }
    });
    const rent = result.termsProposal?.rent ?? null;
    if (rent === null) continue;
    const landlordOwned = rent === combo.listed || rent === combo.concession;
    assert.ok(
      landlordOwned,
      `提案价 ${rent} 必须等于房东的挂牌价 ${combo.listed} 或让价 ${combo.concession}`
    );
    // 只有当房东自己恰好报出该数字时，提案价才允许等于 hardMax
    if (rent === combo.hardMax) {
      assert.ok(
        combo.concession === combo.hardMax || combo.listed === combo.hardMax,
        `提案价 ${rent} 不得由租客私密上限推导得出`
      );
    }
  }
});

test("P0：房东让价低于自己的授权底价时自动抬回底价，不接受越界值", () => {
  const result = evaluate({
    mandate: { budget: { target: 3000, hardMax: 3600 } },
    draft: { listedRent: 3800, minimumAuthorizedRent: 3000, concessionRent: 2000 }
  });
  assert.equal(result.termsProposal?.rent, 3000, "让价不得低于房东自己的授权底价");
});

test("P0：房东让价仍高于租客上限时保持待确认，且不回传差额", () => {
  const result = evaluate({
    mandate: { budget: { target: 3000, hardMax: 3100 } },
    draft: { listedRent: 3800, minimumAuthorizedRent: 3000, concessionRent: 3500 }
  });
  assert.equal(result.termsProposal?.rent ?? null, null);
  const ask = result.blockingUnknowns.find((item) => item.reasonCode === "RENT_CONCESSION_REQUIRED");
  assert.ok(ask, "应继续要求房东考虑下调");
  const serialized = JSON.stringify(result.blockingUnknowns);
  assert.ok(!serialized.includes("3100"), "对外文案不得包含租客私密上限");
  assert.ok(!serialized.includes("400"), "对外文案不得包含与上限的差额");
});
