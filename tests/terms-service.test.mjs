import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizePublicTerms, hashPublicTerms } from "../src/server/terms-service.mjs";

const terms = {
  rent: 3100,
  leaseMonths: 12,
  moveInWindow: { from: "2026-09-03", to: "2026-09-08" },
  feeSummary: { service: 0, intermediary: 0, utilitiesPolicy: "actual_bill" },
  approximateLocation: "静安区 · 静安寺",
  viewingAvailability: "weekend",
  highlights: ["近地铁", "朝南", "近地铁"]
};

test("同语义条款会排序对象键、去重排序数组并得到相同 sha256 hash", () => {
  const reordered = {
    highlights: ["朝南", "近地铁"],
    viewingAvailability: "weekend",
    approximateLocation: "静安区 · 静安寺",
    feeSummary: { utilitiesPolicy: "actual_bill", intermediary: 0, service: 0 },
    moveInWindow: { to: "2026-09-08", from: "2026-09-03" },
    leaseMonths: 12,
    rent: 3100
  };
  assert.equal(canonicalizePublicTerms(terms), canonicalizePublicTerms(reordered));
  assert.equal(hashPublicTerms(terms), hashPublicTerms(reordered));
  assert.match(hashPublicTerms(terms), /^sha256:[a-f0-9]{64}$/u);
});

test("任一条款变化都会改变 hash，金额和日期必须规范", () => {
  assert.notEqual(hashPublicTerms(terms), hashPublicTerms({ ...terms, rent: 3150 }));
  assert.throws(() => canonicalizePublicTerms({ ...terms, rent: 3100.5 }), /整数元/);
  assert.throws(() => canonicalizePublicTerms({ ...terms, moveInWindow: { from: "09-03", to: "2026-09-08" } }), /ISO/);
  assert.throws(() => canonicalizePublicTerms({ ...terms, moveInWindow: { from: "2026-09-09", to: "2026-09-08" } }), /日期范围/);
});

test("allowlist 外字段和任何私密字段都会显式失败", () => {
  assert.throws(() => canonicalizePublicTerms({ ...terms, coupon: 100 }), /未允许字段/);
  assert.throws(() => canonicalizePublicTerms({ ...terms, hardMax: 9999 }), /私密字段/);
  assert.throws(() => canonicalizePublicTerms({ ...terms, feeSummary: { ...terms.feeSummary, contact: "secret" } }), /私密字段/);
});
