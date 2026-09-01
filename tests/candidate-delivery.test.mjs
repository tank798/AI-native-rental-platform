import assert from "node:assert/strict";
import test from "node:test";

import { selectDeliveredCandidates, MAX_DELIVERED_CANDIDATES } from "../src/server/candidate-delivery.mjs";

// ---------------------------------------------------------------------------
// 产品承诺："每个接收方最多交付三条候选，并尽量覆盖不同选择理由。"
// real 模式此前既没有三条上限，selectionLabel 也只有「条件待确认 / 条件匹配」，
// 因此 UI 上按"首选 / 省预算 / 住得好"区分的入选理由在 real 模式下完全不生效。
// ---------------------------------------------------------------------------

function renterCandidate(id, { score, rent, area, roommates = 1, status = "eligible" } = {}) {
  return {
    matchCaseId: id,
    matchCaseStatus: status,
    score,
    agreedRent: rent,
    listing: { room: { areaSqm: area, roommateCount: roommates } }
  };
}

test("最多只投放三条候选（其余保留但标记为未投放）", () => {
  const many = Array.from({ length: 9 }, (_, index) => renterCandidate(`c${index}`, {
    score: 50 + index, rent: 3000 + index * 50, area: 10 + index
  }));
  const result = selectDeliveredCandidates(many, { kind: "renter" });
  const delivered = result.filter((item) => item.delivered);
  assert.equal(delivered.length, MAX_DELIVERED_CANDIDATES);
  assert.equal(MAX_DELIVERED_CANDIDATES, 3);
  // 完整列表必须保留：它同时承担深链 ?match=<caseId> 的案例解析
  assert.equal(result.length, many.length);
});

test("三条候选覆盖三种不同的入选理由，且标签与 UI 着色约定一致", () => {
  const candidates = [
    renterCandidate("best", { score: 96, rent: 3600, area: 14 }),
    renterCandidate("cheap", { score: 71, rent: 2600, area: 11 }),
    renterCandidate("roomy", { score: 78, rent: 3400, area: 26 })
  ];
  const delivered = selectDeliveredCandidates(candidates, { kind: "renter" });
  const labels = delivered.map((item) => item.selectionLabel);
  assert.deepEqual(labels, ["首选", "省预算", "住得好"]);
  // 与 src/app.mjs 的 SELECTION_TONE 键保持一致，否则徽章着色会回落到 neutral
  for (const label of labels) {
    assert.ok(["首选", "省预算", "住得好"].includes(label), label);
  }

  assert.equal(delivered.find((item) => item.selectionLabel === "首选").matchCaseId, "best");
  assert.equal(delivered.find((item) => item.selectionLabel === "省预算").matchCaseId, "cheap");
  assert.equal(delivered.find((item) => item.selectionLabel === "住得好").matchCaseId, "roomy");
});

test("同一条候选不会因为在多个维度都最优而被重复交付", () => {
  const candidates = [
    renterCandidate("dominant", { score: 99, rent: 2000, area: 40 }),
    renterCandidate("second", { score: 60, rent: 3000, area: 12 }),
    renterCandidate("third", { score: 55, rent: 3200, area: 11 })
  ];
  const delivered = selectDeliveredCandidates(candidates, { kind: "renter" });
  const ids = delivered.map((item) => item.matchCaseId);
  assert.equal(new Set(ids).size, ids.length, `不应重复交付：${ids.join(", ")}`);
  assert.equal(delivered[0].matchCaseId, "dominant");
});

test("待确认的候选排在可直接决策的候选之后", () => {
  const candidates = [
    renterCandidate("pending", { score: 99, rent: 2500, area: 30, status: "clarifying" }),
    renterCandidate("ready", { score: 70, rent: 3300, area: 13 })
  ];
  const delivered = selectDeliveredCandidates(candidates, { kind: "renter" });
  assert.equal(delivered[0].matchCaseId, "ready", "分数更高但待确认的候选不应占据首选");
});

test("候选不足时不硬凑标签，也不产生空洞", () => {
  const delivered = selectDeliveredCandidates([
    renterCandidate("only", { score: 80, rent: 3000, area: 15 })
  ], { kind: "renter" });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].selectionLabel, "首选");

  assert.deepEqual(selectDeliveredCandidates([], { kind: "renter" }), []);
  assert.deepEqual(selectDeliveredCandidates(null, { kind: "renter" }), []);
});

test("房东侧用出价与租期稳定性作为差异化维度", () => {
  const supply = (id, { score, rent, leaseMonths }) => ({
    matchCaseId: id,
    matchCaseStatus: "eligible",
    score,
    agreedRent: rent,
    tenant: { mandate: { leaseMonths } }
  });
  const delivered = selectDeliveredCandidates([
    supply("balanced", { score: 95, rent: 3100, leaseMonths: 12 }),
    supply("paysMore", { score: 70, rent: 3600, leaseMonths: 6 }),
    supply("stable", { score: 72, rent: 3000, leaseMonths: 36 })
  ], { kind: "supply" });
  assert.deepEqual(delivered.map((item) => item.selectionLabel), ["首选", "出价更高", "租期更稳"]);
  assert.equal(delivered[1].matchCaseId, "paysMore");
  assert.equal(delivered[2].matchCaseId, "stable");
});

test("相同输入产生稳定顺序，便于前端 diff 与幂等校验", () => {
  const build = () => [
    renterCandidate("a", { score: 80, rent: 3000, area: 15 }),
    renterCandidate("b", { score: 80, rent: 3000, area: 15 }),
    renterCandidate("c", { score: 80, rent: 3000, area: 15 })
  ];
  const first = selectDeliveredCandidates(build(), { kind: "renter" }).map((item) => item.matchCaseId);
  const second = selectDeliveredCandidates(build(), { kind: "renter" }).map((item) => item.matchCaseId);
  assert.deepEqual(first, second);
});

test("投放名额之外的候选仍保留在列表中，避免深链解析失败", () => {
  const many = Array.from({ length: 6 }, (_, index) => renterCandidate(`c${index}`, {
    score: 90 - index * 5, rent: 3000 + index * 100, area: 20 - index
  }));
  const result = selectDeliveredCandidates(many, { kind: "renter" });

  // 全部候选都要在，否则 ?match=<caseId> 会误报"该匹配结果已失效"
  assert.equal(result.length, many.length);
  assert.deepEqual(
    new Set(result.map((item) => item.matchCaseId)),
    new Set(many.map((item) => item.matchCaseId))
  );

  const delivered = result.filter((item) => item.delivered);
  assert.equal(delivered.length, 3, "投放名额仍为三条");
  assert.ok(result.slice(0, 3).every((item) => item.delivered === true), "投放候选排在最前");
  assert.ok(result.slice(3).every((item) => item.delivered === false), "其余标记为未投放");
  assert.ok(result.slice(3).every((item) => !item.selectionLabel), "未投放候选不应带入选理由");
});

test("候选数不超过上限时全部标记为已投放", () => {
  const result = selectDeliveredCandidates([
    renterCandidate("a", { score: 90, rent: 3000, area: 20 }),
    renterCandidate("b", { score: 80, rent: 2800, area: 14 })
  ], { kind: "renter" });
  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.delivered === true));
});
