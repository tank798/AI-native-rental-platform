import test from "node:test";
import assert from "node:assert/strict";

import { baseMandate, demoSupplyDraft, listings } from "../src/fixtures.mjs";
import {
  evaluateListing,
  evaluateReport,
  matchMandate,
  matchSupplyDraft,
  runRegressionSuite,
  validateSupplyDraft
} from "../src/simulation-engine.mjs";
import { createClock } from "../src/clock.mjs";

const byId = (id) => listings.find((listing) => listing.id === id);

test("个人转租可以用条件换取更低租金", () => {
  const result = evaluateListing(baseMandate, byId("home-nanyang"));
  assert.equal(result.status, "eligible");
  assert.equal(result.agreedRent, 3000);
  assert.match(result.agreementLabel, /12 个月/);
});

test("位置文本会按商圈、站点与地址提示归一匹配", () => {
  const mandate = structuredClone(baseMandate);
  mandate.locations = ["静安寺商圈"];

  const result = evaluateListing(mandate, byId("home-nanyang"));
  assert.equal(result.status, "eligible");
});

test("AI 不会越过租户的私密最高预算", () => {
  const result = evaluateListing(baseMandate, byId("home-over-budget"));
  assert.equal(result.status, "excluded");
  assert.ok(result.reasonCodes.includes("budget"));
  assert.equal(result.negotiation.agreedRent, null);
});

test("中介伪装、收费和盗图证据会触发隔离", () => {
  const result = evaluateListing(baseMandate, byId("home-broker-trap"));
  assert.equal(result.status, "quarantine");
  assert.ok(result.reasonCodes.includes("broker_role"));
  assert.ok(result.reasonCodes.includes("prohibited_fee"));
  assert.ok(result.reasonCodes.includes("duplicate_photo"));
});

test("硬性室友性别冲突不会被推荐", () => {
  const result = evaluateListing(baseMandate, byId("home-male-roommates"));
  assert.equal(result.status, "excluded");
  assert.deepEqual(result.reasonCodes, ["roommate_gender"]);
});

test("未知费用与设施信息会保留在候选结果中", () => {
  const result = evaluateListing(baseMandate, byId("home-unknown-utilities"));
  assert.equal(result.status, "eligible");
  assert.deepEqual(result.unknownFacts.sort(), ["水电计价", "洗衣机类型", "物业费", "网费"].sort());
  assert.ok(result.provenance.some((item) => item.source === "尚未确认"));
});

test("候选交付最多三套并覆盖不同选择理由", () => {
  const result = matchMandate(baseMandate, listings);
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(
    result.candidates.map((item) => item.selectionLabel),
    ["综合最合适", "预算最轻", "居住条件最好"]
  );
});

test("面向用户的审计日志不泄露 hardMax 字段或最高预算措辞", () => {
  const result = matchMandate(baseMandate, listings);
  const audit = JSON.stringify(result.audit);
  assert.doesNotMatch(audit, /hardMax/);
  assert.doesNotMatch(audit, /最高预算/);
});

test("有站内客观证据的中介举报触发实名级封禁", () => {
  const result = evaluateReport({
    listing: byId("home-broker-trap"),
    reportType: "broker_or_fee"
  });
  assert.equal(result.status, "identity_banned");
  assert.match(result.immediateAction, /下架/);
});

test("无客观证据的单次举报先隔离复核，不直接永久封禁", () => {
  const result = evaluateReport({
    listing: byId("home-jiangsu"),
    reportType: "broker_or_fee"
  });
  assert.equal(result.status, "quarantined_pending_review");
  assert.match(result.finalAction, /不执行不可逆/);
});

test("发布端只接受房东本人或当前承租人", () => {
  const result = validateSupplyDraft({ ...demoSupplyDraft, role: "broker" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.includes("只允许")));
});

test("可入住日期使用注入的实时时钟，不读固定模拟日期", () => {
  const clock = createClock({ now: () => new Date("2026-08-29T16:00:00.000Z") });
  const result = validateSupplyDraft({ ...demoSupplyDraft, availableFrom: "2026-08-25" }, { clock });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.includes("可入住日期不能早于今天")));
});

test("发布端禁止服务费和中介费", () => {
  const result = validateSupplyDraft({
    ...demoSupplyDraft,
    fees: { ...demoSupplyDraft.fees, service: 399 }
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.includes("服务费")));
});

test("发布端同样禁止信息费、带看费和签约费", () => {
  for (const fee of ["information", "viewing", "signing"]) {
    const result = validateSupplyDraft({
      ...demoSupplyDraft,
      fees: { ...demoSupplyDraft.fees, [fee]: 199 }
    });
    assert.equal(result.valid, false);
  }
});

test("出租端会真实匹配十位租客并排除七类硬冲突", () => {
  const result = matchSupplyDraft(demoSupplyDraft);
  assert.equal(result.scanned, 10);
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(result.candidates.map((item) => item.tenant.alias), ["林同学", "顾女士", "许同学"]);

  const reasons = new Set(result.excluded.flatMap((item) => item.reasonCodes));
  for (const reason of ["roommate_gender", "shared_housing", "location", "budget", "ensuite", "lease_term", "move_in"]) {
    assert.ok(reasons.has(reason), `missing ${reason}`);
  }
});

test("内置产品回归清单全部通过", () => {
  const results = runRegressionSuite();
  assert.ok(results.length >= 12);
  assert.deepEqual(results.filter((item) => !item.passed), []);
});
