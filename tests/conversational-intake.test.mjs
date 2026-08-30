import test from "node:test";
import assert from "node:assert/strict";

import { parseDemandText } from "../src/demand-parser.mjs";
import { createEmptySupplyDraft, parseSupplyText } from "../src/supply-parser.mjs";
import { createIntakeService } from "../src/server/intake-service.mjs";
import { baseMandate } from "../src/fixtures.mjs";
import { listingFromSupplyDraft } from "../src/simulation-engine.mjs";

const referenceDate = "2026-08-28";

test("找房对话可抽取完整匹配条件", () => {
  const parsed = parseDemandText(
    "静安寺附近，预算2800到3600元，9月2日入住，通勤35分钟内，接受女生合租，租12个月，高楼层朝南，周末看房，独卫优先，必须有电梯，民水民电，需要厨房、滚筒洗衣机和网络",
    referenceDate
  );

  assert.deepEqual(parsed.fields.locations, ["静安寺"]);
  assert.deepEqual(parsed.fields.budget, {
    target: 2800,
    hardMax: 3600,
    explicitRange: true,
    capInferred: false
  });
  assert.equal(parsed.fields.moveInWindow.from, "2026-09-02");
  assert.equal(parsed.fields.maxCommuteMinutes, 35);
  assert.equal(parsed.fields.sharedHousing, true);
  assert.equal(parsed.fields.roommateGender, "female");
  assert.equal(parsed.fields.leaseMonths, 12);
  assert.equal(parsed.fields.viewingAvailability, "weekend");
  assert.equal(parsed.fields.preferences.floor, "high");
  assert.equal(parsed.fields.preferences.exposure, "south");
  assert.equal(parsed.fields.preferences.ensuite, "preferred");
  assert.equal(parsed.fields.preferences.elevator, "required");
  assert.equal(parsed.fields.preferences.utilities, "residential");
  assert.equal(parsed.fields.preferences.washerType, "drum");
  assert.equal(parsed.fields.preferences.network, "required");
  assert.equal(parsed.fields.facilities.kitchen, true);
  assert.equal(parsed.fields.facilities.washer, true);
  assert.deepEqual(parsed.coreMissing, []);
});

test("出租对话可抽取角色、房屋事实和零收费条件", () => {
  const parsed = parseSupplyText(
    "我是当前租客，个人转租静安寺次卧，月租3500元，最低3300元，9月3日入住，15平，12/18楼，1位女生室友，朝南，有电梯、独卫、厨房和滚筒洗衣机，民水民电，含网，0中介费0服务费",
    referenceDate
  );

  assert.equal(parsed.fields.role, "subletter");
  assert.equal(parsed.fields.location, "静安寺");
  assert.equal(parsed.fields.listedRent, 3500);
  assert.equal(parsed.fields.minRent, 3300);
  assert.equal(parsed.fields.availableFrom, "2026-09-03");
  assert.equal(parsed.fields.room.areaSqm, 15);
  assert.equal(parsed.fields.room.floor, 12);
  assert.equal(parsed.fields.room.totalFloors, 18);
  assert.equal(parsed.fields.room.roommateCount, 1);
  assert.equal(parsed.fields.room.roommateGender, "female");
  assert.equal(parsed.fields.facilities.exposure, "south");
  assert.equal(parsed.fields.facilities.elevator, true);
  assert.equal(parsed.fields.facilities.ensuite, true);
  assert.equal(parsed.fields.facilities.kitchen, true);
  assert.equal(parsed.fields.facilities.washerType, "drum");
  assert.equal(parsed.fields.facilities.utilities, "residential");
  assert.equal(parsed.fields.facilities.network, "included");
  assert.deepEqual(parsed.fields.fees, { service: 0, intermediary: 0 });
  assert.deepEqual(parsed.riskSignals, []);
});

test("新房源草稿不继承 demo 面积、楼层或 12 个月租期", () => {
  const draft = createEmptySupplyDraft();

  assert.equal(draft.areaSqm, null);
  assert.equal(draft.floor, null);
  assert.equal(draft.totalFloors, null);
  assert.equal(draft.leaseMonthsMin, null);
  assert.equal(draft.facilities.kitchen, null);
  assert.equal(draft.facilities.washer, null);
  const listing = listingFromSupplyDraft({
    ...draft,
    role: "landlord",
    location: "静安寺",
    address: "某小区 1 号",
    title: "待确认房源",
    listedRent: 3_200,
    minimumAuthorizedRent: 3_200,
    availableFrom: "2026-09-03",
    leaseMonthsMin: 6,
    areaSqm: 15,
    floor: 9,
    totalFloors: 18
  }, baseMandate, 0);
  assert.equal(listing.facilities.kitchen, null);
  assert.equal(listing.facilities.washer, null);
  assert.equal(listing.fees.networkMonthly, null);
});

test("自然语言零收费承诺不会把个人转租误判为中介", () => {
  const parsed = parseSupplyText(
    "我是当前租客，个人转租静安寺次卧，月租3500元，9月3日起租，1位女生室友，不收任何中介费服务费",
    referenceDate
  );

  assert.equal(parsed.fields.role, "subletter");
  assert.deepEqual(parsed.fields.fees, { service: 0, intermediary: 0 });
  assert.doesNotMatch(JSON.stringify(parsed.riskSignals), /broker_role|role_conflict|prohibited_fee/);
});

test("明确中介代发不会被零中介费承诺洗掉角色风险", () => {
  const parsed = parseSupplyText(
    "中介代发静安寺次卧，月租3500元，9月3日起租，1位女生室友，不收中介费",
    referenceDate
  );

  assert.equal(parsed.fields.role, "broker");
  assert.ok(parsed.riskSignals.includes("broker_role"));
  assert.ok(parsed.riskSignals.includes("role_conflict"));
});

test("中介身份或任一服务收费会在发布前暴露为风险", () => {
  const parsed = parseSupplyText(
    "我是公寓管家，中介代发静安寺房源，月租3000元，9月2日入住，1位女生室友，另收500元服务费",
    referenceDate
  );

  assert.equal(parsed.fields.role, "broker");
  assert.equal(parsed.fields.fees.service, 500);
  assert.ok(parsed.riskSignals.includes("broker_role"));
  assert.ok(parsed.riskSignals.includes("role_conflict"));
  assert.ok(parsed.riskSignals.includes("prohibited_fee"));
});

test("运行时结构化在没有模型 Key 时仍走可审计的安全模式", async () => {
  const intake = createIntakeService();
  const renter = await intake.parseRenter("静安寺附近，预算 3000 到 3500，9 月 2 日入住，通勤 35 分钟", referenceDate);
  assert.equal(renter.provider, "deterministic");
  assert.deepEqual(renter.parsed.fields.locations, ["静安寺"]);
  assert.equal(renter.parsed.fields.budget.hardMax, 3500);

  const supply = await intake.parseSupply("房东本人直租静安寺，月租 3200 元，9 月 3 日入住", referenceDate);
  assert.equal(supply.provider, "deterministic");
  assert.equal(supply.parsed.fields.role, "landlord");
  assert.equal(supply.parsed.fields.listedRent, 3200);
});

test("每轮最多保留三个绑定 fieldKey 的高价值问题", async () => {
  const intake = createIntakeService();
  const renter = await intake.parseRenter("预算 3000 左右", referenceDate);

  assert.equal(renter.parsed.questions.length, 3);
  assert.equal(new Set(renter.parsed.questions.map((question) => question.fieldKey)).size, 3);
  assert.ok(renter.parsed.questions.every((question) => question.reasonCode && question.question));
});

test("模型补充字段不能覆盖规则解析出的明确事实", async () => {
  const originalFetch = globalThis.fetch;
  const modelPayloads = [
    {
      renters: [{
        city: "北京",
        locations: ["北京国贸"],
        budget: { target: 999, max: 999 },
        move_in: { from: "2027-01-01", to: "2027-01-02" },
        max_commute_minutes: 10,
        housing: { shared: false, roommate_gender: null },
        hard: { kitchen: false, washer: false, elevator: false, ensuite: false, residential_utilities: false }
      }]
    },
    {
      listings: [{
        city: "北京",
        location: "北京国贸",
        role: "broker",
        claimed_role: "broker",
        listed_rent: 999,
        private_min_rent: 1,
        available_from: "2027-01-01",
        housing: { shared: false, roommate_gender: null },
        facilities: { elevator: false, ensuite: false, kitchen: false, washer: false, residential_utilities: false },
        fees: { service: 999, intermediary: 999 },
        risk_signals: ["broker_role", "role_conflict", "prohibited_fee"]
      }]
    }
  ];
  globalThis.fetch = async () => {
    const modelPayload = modelPayloads.shift();
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(modelPayload) } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const intake = createIntakeService({ apiKey: "test-key" });
    const result = await intake.parseRenter(
      "静安寺附近，预算 2800 到 3600 元，9 月 2 日入住，通勤 35 分钟内，接受女生合租，需要厨房和洗衣机",
      referenceDate
    );
    assert.equal(result.provider, "siliconflow");
    assert.equal(result.parsed.fields.city, "上海");
    assert.deepEqual(result.parsed.fields.locations, ["静安寺"]);
    assert.deepEqual(result.parsed.fields.budget, {
      target: 2800,
      hardMax: 3600,
      explicitRange: true,
      capInferred: false
    });
    assert.equal(result.parsed.fields.maxCommuteMinutes, 35);
    assert.equal(result.parsed.fields.sharedHousing, true);
    assert.equal(result.parsed.fields.facilities.kitchen, true);
    assert.equal(result.parsed.fields.facilities.washer, true);

    const supply = await intake.parseSupply(
      "房东本人直租静安寺，月租 3200 元，0中介费0服务费，9 月 3 日入住，1 位女生室友",
      referenceDate
    );
    assert.equal(supply.provider, "siliconflow");
    assert.equal(supply.parsed.fields.role, "landlord");
    assert.equal(supply.parsed.fields.listedRent, 3200);
    assert.equal(supply.parsed.fields.fees.service, 0);
    assert.equal(supply.parsed.fields.fees.intermediary, 0);
    assert.doesNotMatch(JSON.stringify(supply.parsed.riskSignals), /broker_role|role_conflict|prohibited_fee/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("模型字段类型错误时使用稳定警告降级且不回显 provider 内容", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ renters: [{ locations: "错误字符串" }] }) } }]
  }), { status: 200 });
  try {
    const intake = createIntakeService({ apiKey: "test-key" });
    const result = await intake.parseRenter("静安寺找房，预算 3500", referenceDate);

    assert.equal(result.provider, "deterministic");
    assert.equal(result.warningCode, "AI_DEGRADED");
    assert.equal(result.warning, "AI 暂时不可用，已使用确定性解析");
    assert.doesNotMatch(result.warning, /locations|MODEL_SCHEMA|provider/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
