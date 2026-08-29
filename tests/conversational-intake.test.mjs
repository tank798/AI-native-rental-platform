import test from "node:test";
import assert from "node:assert/strict";

import { parseDemandText } from "../src/demand-parser.mjs";
import { parseSupplyText } from "../src/supply-parser.mjs";

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
