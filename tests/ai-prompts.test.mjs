import test from "node:test";
import assert from "node:assert/strict";

import { renterCases, listingCases, goldenExpectations } from "../evals/rental-eval-cases.mjs";
import {
  renterIntakePrompt,
  supplyNormalizePrompt,
  riskAuditPrompt,
  matchPrompt,
  negotiationPrompt,
  finalSelectionPrompt
} from "../src/ai/prompts.mjs";

const sampleRenter = { renter_id: "R0", budget: { target: 3000, max: 3300 } };
const sampleListing = { listing_id: "H0", listed_rent: 3500, private_min_rent: 3200 };

test("评测数据覆盖 10 位租客和 10 套房源", () => {
  assert.equal(renterCases.length, 10);
  assert.equal(listingCases.length, 10);
  assert.equal(Object.keys(goldenExpectations.expectedTop).length, 10);
});

test("每个代理 Prompt 都包含角色、核心原则、Few-shot 和私有推理边界", () => {
  const prompts = [
    renterIntakePrompt(renterCases),
    supplyNormalizePrompt(listingCases),
    riskAuditPrompt([sampleListing]),
    matchPrompt(sampleRenter, [sampleListing]),
    negotiationPrompt([{ renter_id: "R0", listing_id: "H0" }]),
    finalSelectionPrompt({ renters: [sampleRenter], listings: [sampleListing], matches: [], negotiations: [] })
  ];

  for (const prompt of prompts) {
    assert.match(prompt.system, /# 角色/);
    assert.match(prompt.system, /# 核心原则/);
    assert.match(prompt.system, /# Few-shot/);
    assert.match(prompt.system, /# 内部推理规范/);
    assert.match(prompt.system, /不要输出逐步思维链/);
    assert.match(prompt.system, /只输出一个合法 JSON/);
  }
});

test("风控 Prompt 不把私密底价发送给风控代理", () => {
  const prompt = riskAuditPrompt([sampleListing]);
  assert.doesNotMatch(prompt.user, /private_min_rent/);
  assert.doesNotMatch(prompt.user, /3200/);
});

test("最终交付 Prompt 不携带私密底价", () => {
  const { private_min_rent: _private, ...publicListing } = sampleListing;
  const prompt = finalSelectionPrompt({ renters: [sampleRenter], listings: [publicListing], matches: [], negotiations: [] });
  assert.doesNotMatch(prompt.user, /private_min_rent/);
  assert.doesNotMatch(prompt.user, /3200/);
});
