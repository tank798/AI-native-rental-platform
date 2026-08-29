import test from "node:test";
import assert from "node:assert/strict";

import { parseDemandText } from "../src/demand-parser.mjs";
import {
  MARKET_REFERENCE_DATE,
  landlordCopyCases,
  marketplaceListings,
  marketplaceTenants,
  tenantCopyCases
} from "../src/marketplace-corpus.mjs";
import { matchMandate, matchSupplyDraft } from "../src/simulation-engine.mjs";
import { parseSupplyText } from "../src/supply-parser.mjs";

test("语料库包含 100 条出租文案和 100 条找房需求", () => {
  assert.equal(landlordCopyCases.length, 100);
  assert.equal(tenantCopyCases.length, 100);
  assert.equal(marketplaceListings.length, 100);
  assert.equal(marketplaceTenants.length, 100);
});

test("100 条出租文案的核心字段全部按真值识别", () => {
  for (const item of landlordCopyCases) {
    const parsed = parseSupplyText(item.input, MARKET_REFERENCE_DATE);
    assert.equal(parsed.fields.role, item.expected.role, `${item.id} role`);
    assert.equal(parsed.fields.claimedRole, item.expected.claimedRole, `${item.id} claimedRole`);
    assert.equal(parsed.fields.location, item.expected.location, `${item.id} location`);
    assert.equal(parsed.fields.station, item.expected.station, `${item.id} station`);
    assert.equal(parsed.fields.listedRent, item.expected.listedRent, `${item.id} rent`);
    assert.equal(parsed.fields.minRent, item.expected.minRent, `${item.id} minRent`);
    assert.equal(parsed.fields.availableFrom, item.expected.availableFrom, `${item.id} availableFrom`);
    assert.equal(parsed.fields.room.roommateCount, item.expected.roommateCount, `${item.id} roommateCount`);
    assert.equal(parsed.fields.room.roommateGender, item.expected.roommateGender, `${item.id} roommateGender`);
  }
});

test("100 条租户文案的核心字段全部按真值识别", () => {
  for (const item of tenantCopyCases) {
    const parsed = parseDemandText(item.input, MARKET_REFERENCE_DATE);
    assert.equal(parsed.fields.locations[0] || null, item.expected.location, `${item.id} location`);
    assert.equal(parsed.fields.budget?.target ?? null, item.expected.target, `${item.id} target`);
    assert.equal(parsed.fields.budget?.hardMax ?? null, item.expected.hardMax, `${item.id} hardMax`);
    const parsedMoveIn = parsed.fields.moveInWindow
      ? { from: parsed.fields.moveInWindow.from, to: parsed.fields.moveInWindow.to }
      : null;
    assert.deepEqual(parsedMoveIn, item.expected.moveInWindow, `${item.id} moveIn`);
    assert.equal(parsed.fields.maxCommuteMinutes, item.expected.maxCommuteMinutes, `${item.id} commute`);
    assert.equal(parsed.fields.sharedHousing, item.expected.sharedHousing, `${item.id} sharedHousing`);
    assert.equal(parsed.fields.roommateGender, item.expected.roommateGender, `${item.id} roommateGender`);
  }
});

test("100×100 找房市场既能匹配也允许真实空结果", () => {
  const results = marketplaceTenants.map((tenant) => matchMandate(tenant.mandate, marketplaceListings));
  assert.ok(results.every((result) => result.scanned === 100));
  assert.ok(results.some((result) => result.candidates.length > 0));
  assert.ok(results.some((result) => result.candidates.length === 0));
  assert.ok(results.every((result) => result.candidates.length <= 3));
  assert.ok(results.flatMap((result) => result.candidates).every((candidate) => ["landlord", "subletter"].includes(candidate.listing.role)));
});

test("合规出租任务会反向扫描 100 位真实测试租客", () => {
  const validCase = landlordCopyCases.find((item) => item.risk === "clear" && item.draft.role === "subletter");
  const result = matchSupplyDraft(validCase.draft, marketplaceTenants);
  assert.equal(result.validation.valid, true);
  assert.equal(result.scanned, 100);
  assert.ok(result.candidates.length <= 3);
});
