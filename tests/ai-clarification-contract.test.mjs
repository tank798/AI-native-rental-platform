import assert from "node:assert/strict";
import test from "node:test";

import { clarificationPrompt } from "../src/ai/clarification-prompt.mjs";
import { parseClarificationModelOutput } from "../src/ai/clarification-schema.mjs";

test("Qwen 澄清 Prompt 只包含公开上下文和固定答案契约", () => {
  const prompt = clarificationPrompt({
    fieldKey: "listing.fees.utilities",
    reasonCode: "TOTAL_COST_BLOCKING_UNKNOWN",
    expectedAnswerType: "enum",
    options: ["included", "actual_bill", "fixed_extra", "unknown"],
    templateQuestion: "水电费是包含在月租中，还是按账单另付？",
    publicContext: { approximateLocation: "静安区 · 静安寺" }
  });
  const serialized = JSON.stringify(prompt);
  assert.match(serialized, /TOTAL_COST_BLOCKING_UNKNOWN/);
  assert.match(serialized, /requiredOutput/);
  assert.match(serialized, /只改写/);
  assert.doesNotMatch(serialized, /hardMax|minimumAuthorizedRent|rawText|evidenceRefs|sessionToken/);
});

test("模型只能润色问题，不能修改字段、类型、选项或夹带私密字段", () => {
  const expected = {
    fieldKey: "listing.fees.utilities",
    reasonCode: "TOTAL_COST_BLOCKING_UNKNOWN",
    expectedAnswerType: "enum",
    options: ["included", "actual_bill", "fixed_extra", "unknown"]
  };
  const parsed = parseClarificationModelOutput({
    question: "水电燃气费是包含在月租中，还是按账单另付？",
    ...expected
  }, expected);
  assert.equal(parsed.fieldKey, expected.fieldKey);
  assert.throws(() => parseClarificationModelOutput({ ...parsed, fieldKey: "budget.hardMax" }, expected), /fieldKey/);
  assert.throws(() => parseClarificationModelOutput({ ...parsed, hardMax: 9_999 }, expected), /unauthorized|未授权/i);
  assert.throws(() => parseClarificationModelOutput({ ...parsed, question: "对方最高预算是多少？" }, expected), /公开边界/);
});
