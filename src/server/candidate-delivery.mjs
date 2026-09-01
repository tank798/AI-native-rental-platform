/**
 * 候选投放层：把服务端逐对增量算出的全部候选，收敛成"最多三条且覆盖不同选择理由"。
 *
 * 为什么放在读取/投放层而不是写入层：
 * 候选是按 pair 事件驱动增量 upsert 的，任一时刻的单次写入都只看到一对任务，
 * 拿不到"该接收方当前的全部候选"。若在写入层做 TopN，就必须在每次成对评估后
 * 重排并改写其他候选行，既放大写放大，也会破坏案例状态与审计的一对一关系。
 * 因此写入层保持完整、可审计，收敛只在投放时进行。
 */

export const MAX_DELIVERED_CANDIDATES = 3;

/** 待确认的候选排在可直接决策的候选之后。 */
function readiness(candidate) {
  return candidate?.matchCaseStatus === "clarifying" ? 1 : 0;
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 综合评分降序；同分时用 matchCaseId 兜底，保证同输入下顺序稳定可复现。 */
function byOverall(left, right) {
  return readiness(left) - readiness(right)
    || numberOr(right.score, 0) - numberOr(left.score, 0)
    || String(left.matchCaseId || "").localeCompare(String(right.matchCaseId || ""));
}

function byCheapest(left, right) {
  return readiness(left) - readiness(right)
    || numberOr(left.agreedRent, Number.POSITIVE_INFINITY) - numberOr(right.agreedRent, Number.POSITIVE_INFINITY)
    || byOverall(left, right);
}

/** 居住条件：面积优先，其次室友更少。 */
function byLivingQuality(left, right) {
  const area = (item) => numberOr(item?.listing?.room?.areaSqm, -1);
  const roommates = (item) => numberOr(item?.listing?.room?.roommateCount, Number.POSITIVE_INFINITY);
  return readiness(left) - readiness(right)
    || area(right) - area(left)
    || roommates(left) - roommates(right)
    || byOverall(left, right);
}

// 与 UI 的 SELECTION_TONE 一一对应；顺序即优先级。
const RENTER_PICKS = [
  { label: "首选", compare: byOverall },
  { label: "省预算", compare: byCheapest },
  { label: "住得好", compare: byLivingQuality }
];

// 房东侧没有"居住条件"维度，用租客的租期稳定性替代第三个视角。
function byLeaseStability(left, right) {
  const months = (item) => numberOr(item?.tenant?.mandate?.leaseMonths, -1);
  return readiness(left) - readiness(right)
    || months(right) - months(left)
    || byOverall(left, right);
}

const SUPPLY_PICKS = [
  { label: "首选", compare: byOverall },
  { label: "出价更高", compare: (left, right) => readiness(left) - readiness(right)
    || numberOr(right.agreedRent, -1) - numberOr(left.agreedRent, -1)
    || byOverall(left, right) },
  { label: "租期更稳", compare: byLeaseStability }
];

function keyOf(candidate, index) {
  return String(candidate?.matchCaseId || candidate?.counterpartyId || `idx-${index}`);
}

/**
 * 按不同维度依次挑选投放候选，保证交付的每一条都有各自的入选理由。
 *
 * 返回**全部**候选（按投放优先级排序），其中前 limit 条带 delivered: true
 * 与差异化 selectionLabel，其余为 delivered: false。
 *
 * 为什么不直接截断：snapshot.candidates 同时承担两个职责 ——
 * 结果页列表展示，以及深链 `?match=<caseId>` 的案例解析。
 * 若在此截断，排在投放名额之外的案例就无法被解析，
 * 用户打开一个真实有效、且正等自己确认的案例时会收到"该匹配结果已失效"。
 * 因此这里只做排序与标注，"最多三条"由展示层依据 delivered 落实。
 */
export function selectDeliveredCandidates(candidates, { kind = "renter", limit = MAX_DELIVERED_CANDIDATES } = {}) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!list.length) return [];

  const picks = kind === "supply" ? SUPPLY_PICKS : RENTER_PICKS;
  const chosen = [];
  const taken = new Set();

  const keyFor = (candidate) => keyOf(candidate, list.indexOf(candidate));

  for (const pick of picks.slice(0, limit)) {
    const next = [...list].sort(pick.compare).find((candidate) => !taken.has(keyFor(candidate)));
    if (!next) break;
    taken.add(keyFor(next));
    chosen.push({ ...next, selectionLabel: pick.label, delivered: true });
  }

  // 维度用尽仍未达上限时按综合分补齐，标签留空，避免语义重复的标签。
  if (chosen.length < limit) {
    for (const candidate of [...list].sort(byOverall)) {
      if (chosen.length >= limit) break;
      const key = keyFor(candidate);
      if (taken.has(key)) continue;
      taken.add(key);
      chosen.push({ ...candidate, selectionLabel: "", delivered: true });
    }
  }

  // 其余候选保留在列表中（供深链解析与审计），但不计入投放名额。
  const rest = [...list]
    .sort(byOverall)
    .filter((candidate) => !taken.has(keyFor(candidate)))
    .map((candidate) => ({ ...candidate, delivered: false }));

  return [...chosen, ...rest];
}
