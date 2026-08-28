import test from "node:test";
import assert from "node:assert/strict";

import { enforceEvaluation, sanitizeNegotiations, enforceSelections } from "../src/ai/policy-engine.mjs";

const renter = {
  renter_id: "R09",
  city: "Shanghai",
  locations: ["南京西路"],
  publisher_role: "landlord",
  budget: { target: 4500, max: 5200 },
  move_in: { from: "2026-08-28", to: "2026-09-05" },
  housing: { shared: false, roommate_gender: null },
  hard: { ensuite: true }
};

const sublet = {
  listing_id: "H10",
  city: "上海",
  location: "静安寺",
  station: "静安寺",
  role: "subletter",
  listed_rent: 3700,
  private_min_rent: 3400,
  available_from: "2026-09-08",
  housing: { shared: true, roommate_gender: "female" },
  facilities: { ensuite: true }
};

test("策略闸门否决模型误放行的角色、位置、整租和日期冲突", () => {
  const result = enforceEvaluation(renter, sublet, {
    listing_id: "H10",
    eligible: true,
    hard_conflicts: [],
    unknowns: [],
    preference_score: 99,
    needs_negotiation: false,
    public_reason: "很合适",
    evidence: []
  });
  assert.equal(result.eligible, false);
  assert.equal(result.hard_conflicts.includes("city"), false);
  assert.deepEqual(result.hard_conflicts.filter((item) => ["location", "publisher_role", "shared_housing", "move_in"].includes(item)), [
    "location",
    "publisher_role",
    "shared_housing",
    "move_in"
  ]);
});

test("匹配依据不会把模型写出的私密底价带到公开结果", () => {
  const listing = { ...sublet, location: "南京西路", station: "南京西路", role: "landlord", housing: { shared: false }, available_from: "2026-09-01" };
  const result = enforceEvaluation(renter, listing, {
    listing_id: "H11",
    eligible: true,
    hard_conflicts: [],
    unknowns: [],
    preference_score: 90,
    needs_negotiation: false,
    public_reason: "房源底价在最高预算内",
    evidence: ["private_min_rent=3400", "role=landlord"]
  });
  assert.doesNotMatch(JSON.stringify(result), /private_min|底价|最高预算/);
  assert.deepEqual(result.evidence, ["role=landlord"]);
});

test("议价出站层移除底价与预算上限措辞", () => {
  const { negotiations, leakCount } = sanitizeNegotiations(
    [
      {
        renter_id: "R1",
        listing_id: "H1",
        status: "tentative_agreement",
        agreed_rent: 3200,
        private_data_leaked: false,
        public_events: [{ actor: "supply_agent", action: "报出底价 3200", rent: 3200, condition: "不低于底价" }],
        final_note: "租客最高预算高于房源底价。"
      }
    ],
    [{ renter_id: "R1", listing_id: "H1", private_max_rent: 3300, private_min_rent: 3200 }]
  );
  assert.equal(leakCount, 1);
  assert.equal(negotiations[0].status, "tentative_agreement");
  assert.doesNotMatch(JSON.stringify(negotiations), /底价|最高预算|private_min|private_max/);
});

test("最终交付层删除未通过硬筛的推荐", () => {
  const selections = enforceSelections({
    selections: [{ renter_id: "R09", status: "matched", recommendations: [{ listing_id: "H10", rank: 1 }], summary: "有一套" }],
    decisions: [{ listing_id: "H10", decision: "allow" }],
    matches: [{ renter_id: "R09", evaluations: [{ listing_id: "H10", eligible: false }] }],
    negotiations: []
  });
  assert.equal(selections[0].status, "no_fit");
  assert.deepEqual(selections[0].recommendations, []);
});

test("最终候选卡改写预算上限措辞", () => {
  const selections = enforceSelections({
    selections: [{
      renter_id: "R01",
      status: "matched",
      recommendations: [{
        listing_id: "H01",
        rank: 1,
        match_points: ["位置合适"],
        caveats: ["挂牌价高于预算上限3300元"],
        verified_facts: ["角色已核验"],
        headline: "静安寺次卧"
      }],
      summary: "挂牌价高于最高预算，但已达成意向。"
    }],
    decisions: [{ listing_id: "H01", decision: "allow" }],
    matches: [{ renter_id: "R01", evaluations: [{ listing_id: "H01", eligible: true, needs_negotiation: false }] }],
    negotiations: []
  });
  assert.doesNotMatch(JSON.stringify(selections), /预算上限|最高预算/);
});
