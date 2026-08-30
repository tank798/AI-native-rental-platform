import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFieldProposal,
  confirmField,
  diffFieldVersions,
  resolveFieldValue
} from "../src/field-state.mjs";

test("已经用户确认的字段不会被新 AI proposal 覆盖", () => {
  const proposed = applyFieldProposal(null, { value: 30, source: "ai", confidence: 0.82 });
  const confirmed = confirmField(proposed, 25);
  const conflicted = applyFieldProposal(confirmed, { value: 35, source: "ai", confidence: 0.96 });

  assert.equal(resolveFieldValue(conflicted), 25);
  assert.equal(conflicted.confirmationStatus, "user_confirmed");
  assert.equal(conflicted.version, 2);
  assert.deepEqual(conflicted.conflictSuggestion, { value: 35, source: "ai", confidence: 0.96 });
});

test("字段版本差异只返回真正变更的 key", () => {
  const before = {
    commute: confirmField(null, 30),
    budgetMax: confirmField(null, 4_000)
  };
  const after = {
    commute: confirmField(before.commute, 25),
    budgetMax: before.budgetMax
  };

  assert.deepEqual(diffFieldVersions(before, after), [{
    fieldKey: "commute",
    beforeVersion: 1,
    afterVersion: 2,
    beforeValue: 30,
    afterValue: 25
  }]);
});
