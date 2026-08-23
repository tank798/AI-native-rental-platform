import test from "node:test";
import assert from "node:assert/strict";

import { parseDemandText, parsedDemandTags } from "../src/demand-parser.mjs";

test("parses a complete natural-language rental request", () => {
  const parsed = parseDemandText("静安寺附近，预算 3000 到 3100，9 月初入住，通勤不超过 35 分钟，可以接受女生合租，需要厨房和洗衣机，独卫最好。", "2026-08-23");

  assert.deepEqual(parsed.fields.locations, ["静安寺"]);
  assert.equal(parsed.fields.budget.target, 3000);
  assert.equal(parsed.fields.budget.hardMax, 3100);
  assert.equal(parsed.fields.moveInWindow.to, "2026-09-05");
  assert.equal(parsed.fields.maxCommuteMinutes, 35);
  assert.equal(parsed.fields.sharedHousing, true);
  assert.equal(parsed.fields.roommateGender, "female");
  assert.equal(parsed.fields.facilities.kitchen, true);
  assert.equal(parsed.fields.facilities.washer, true);
  assert.equal(parsed.fields.preferences.ensuite, "preferred");
});

test("a single approximate budget still asks for the upper bound", () => {
  const parsed = parseDemandText("静安寺附近，预算 3000 左右，9 月初入住，女生合租，通勤 35 分钟", "2026-08-23");

  assert.equal(parsed.fields.budget.target, 3000);
  assert.equal(parsed.fields.budget.hardMax, null);
  assert.ok(parsed.coreMissing.includes("budget"));
});

test("infers the shared K unit in a budget range", () => {
  const parsed = parseDemandText("预算 2~3K，徐家汇，8 月底入住，整租，半小时通勤", "2026-08-23");

  assert.equal(parsed.fields.budget.target, 2000);
  assert.equal(parsed.fields.budget.hardMax, 3000);
  assert.equal(parsed.fields.budget.explicitRange, true);
  assert.equal(parsed.fields.sharedHousing, false);
  assert.equal(parsed.fields.maxCommuteMinutes, 30);
});

test("accepts locations outside the built-in fixture catalog", () => {
  const parsed = parseDemandText("我想住漕河泾附近，预算 3500 到 4500，9 月入住", "2026-08-23");

  assert.deepEqual(parsed.fields.locations, ["漕河泾"]);
  assert.ok(!parsed.coreMissing.includes("location"));
});

test("reports only genuinely missing core fields", () => {
  const parsed = parseDemandText("预算不超过 3200，能合租");

  assert.equal(parsed.fields.budget.hardMax, 3200);
  assert.deepEqual(parsed.coreMissing, ["location", "moveIn", "commute"]);
});

test("recognizes an exact move-in date", () => {
  const parsed = parseDemandText("江苏路，9 月 2 日入住，租金 2900，女生合租，通勤 25 分钟以内");

  assert.equal(parsed.fields.moveInWindow.from, "2026-09-02");
  assert.equal(parsed.fields.moveInWindow.to, "2026-09-06");
});

test("generic flexibility still asks for a concrete date range", () => {
  const parsed = parseDemandText("静安寺附近，预算 3000 到 3500，时间灵活，可以合租，通勤 35 分钟", "2026-08-23");

  assert.equal(parsed.fields.moveInWindow, null);
  assert.ok(parsed.coreMissing.includes("moveIn"));
});

test("builds concise tags from detected facts", () => {
  const tags = parsedDemandTags(parseDemandText("静安寺和江苏路，预算 2800 到 3200，9 月初入住，女生合租，通勤 35 分钟以内，朝南"));

  assert.ok(tags.includes("静安寺 / 江苏路"));
  assert.ok(tags.includes("¥2,800–3,200"));
  assert.ok(tags.includes("女生合租"));
  assert.ok(tags.includes("朝南"));
});
