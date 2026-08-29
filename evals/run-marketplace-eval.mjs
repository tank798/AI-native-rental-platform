import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDemandText } from "../src/demand-parser.mjs";
import {
  MARKET_REFERENCE_DATE,
  landlordCopyCases,
  marketplaceCorpusStats,
  marketplaceListings,
  marketplaceTenants,
  tenantCopyCases
} from "../src/marketplace-corpus.mjs";
import { matchMandate, matchSupplyDraft } from "../src/simulation-engine.mjs";
import { parseSupplyText } from "../src/supply-parser.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const casebookPath = path.join(rootDir, "docs", "matching-casebook.md");

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function check(label, actual, expected) {
  return { label, actual, expected, passed: equal(actual, expected) };
}

function landlordEvaluation(caseItem) {
  const parsed = parseSupplyText(caseItem.input, MARKET_REFERENCE_DATE);
  const checks = [
    check("发布角色", parsed.fields.role, caseItem.expected.role),
    check("声明角色", parsed.fields.claimedRole, caseItem.expected.claimedRole),
    check("区域", parsed.fields.location, caseItem.expected.location),
    check("地铁站", parsed.fields.station, caseItem.expected.station),
    check("挂牌租金", parsed.fields.listedRent, caseItem.expected.listedRent),
    check("授权底价", parsed.fields.minRent, caseItem.expected.minRent),
    check("可入住日", parsed.fields.availableFrom, caseItem.expected.availableFrom),
    check("室友人数", parsed.fields.room.roommateCount, caseItem.expected.roommateCount),
    check("室友性别", parsed.fields.room.roommateGender, caseItem.expected.roommateGender),
    check("服务费", parsed.fields.fees.service ?? 0, caseItem.expected.serviceFee)
  ];
  return { caseItem, parsed, checks, passed: checks.every((item) => item.passed) };
}

function tenantEvaluation(caseItem) {
  const parsed = parseDemandText(caseItem.input, MARKET_REFERENCE_DATE);
  const parsedMoveIn = parsed.fields.moveInWindow
    ? { from: parsed.fields.moveInWindow.from, to: parsed.fields.moveInWindow.to }
    : null;
  const checks = [
    check("区域", parsed.fields.locations[0] || null, caseItem.expected.location),
    check("目标租金", parsed.fields.budget?.target ?? null, caseItem.expected.target),
    check("预算上限", parsed.fields.budget?.hardMax ?? null, caseItem.expected.hardMax),
    check("入住窗口", parsedMoveIn, caseItem.expected.moveInWindow),
    check("通勤上限", parsed.fields.maxCommuteMinutes, caseItem.expected.maxCommuteMinutes),
    check("是否合租", parsed.fields.sharedHousing, caseItem.expected.sharedHousing),
    check("室友性别", parsed.fields.roommateGender, caseItem.expected.roommateGender)
  ];
  return { caseItem, parsed, checks, passed: checks.every((item) => item.passed) };
}

function percent(passed, total) {
  return `${((passed / Math.max(1, total)) * 100).toFixed(1)}%`;
}

function inline(value) {
  if (value === null || value === undefined || value === "") return "未识别";
  if (Array.isArray(value)) return value.length ? value.join(" / ") : "无";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function quote(text) {
  return String(text).split("\n").map((line) => `> ${line}`).join("\n");
}

const startedAt = performance.now();
const landlordResults = landlordCopyCases.map(landlordEvaluation);
const tenantResults = tenantCopyCases.map(tenantEvaluation);

const demandMatchResults = marketplaceTenants.map((tenant) => ({
  tenant,
  result: matchMandate(tenant.mandate, marketplaceListings)
}));
const supplyMatchResults = landlordCopyCases.map((caseItem) => ({
  caseItem,
  result: matchSupplyDraft(caseItem.draft, marketplaceTenants)
}));
const elapsedMs = Math.round(performance.now() - startedAt);

const landlordChecks = landlordResults.flatMap((item) => item.checks);
const tenantChecks = tenantResults.flatMap((item) => item.checks);
const matchedDemandCount = demandMatchResults.filter((item) => item.result.candidates.length > 0).length;
const unmatchedDemandCount = demandMatchResults.length - matchedDemandCount;
const publishableSupplyCount = supplyMatchResults.filter((item) => item.result.validation.valid).length;
const matchedSupplyCount = supplyMatchResults.filter((item) => item.result.candidates.length > 0).length;
const totalDemandPairs = demandMatchResults.reduce((sum, item) => sum + item.result.scanned, 0);
const totalSupplyPairs = supplyMatchResults.reduce((sum, item) => sum + item.result.scanned, 0);
const invalidCandidateCount = demandMatchResults
  .flatMap((item) => item.result.candidates)
  .filter((candidate) => candidate.status !== "eligible" || !["landlord", "subletter"].includes(candidate.listing.role)).length;
const privateLeakCount = demandMatchResults.filter((item) => /hardMax|最高预算|底价/.test(JSON.stringify(item.result.audit))).length;

const lines = [
  "# 住哪儿：200 条供需识别与匹配 Casebook",
  "",
  `> 基准日期：${MARKET_REFERENCE_DATE}。本文件由 \`npm run eval:marketplace\` 从同一份可执行语料自动生成，避免文档与代码结果漂移。`,
  "",
  "## 评测摘要",
  "",
  `- 房东/转租文案：${landlordCopyCases.length} 条，字段断言 ${landlordChecks.filter((item) => item.passed).length}/${landlordChecks.length}，准确率 ${percent(landlordChecks.filter((item) => item.passed).length, landlordChecks.length)}。`,
  `- 租户需求文案：${tenantCopyCases.length} 条，字段断言 ${tenantChecks.filter((item) => item.passed).length}/${tenantChecks.length}，准确率 ${percent(tenantChecks.filter((item) => item.passed).length, tenantChecks.length)}。`,
  `- 找房方向：真实扫描 ${totalDemandPairs.toLocaleString("zh-CN")} 个供需配对；${matchedDemandCount} 条需求获得候选，${unmatchedDemandCount} 条因硬条件无交集返回空结果。`,
  `- 出租方向：${publishableSupplyCount} 条房源通过发布资格；真实扫描 ${totalSupplyPairs.toLocaleString("zh-CN")} 个反向配对；${matchedSupplyCount} 条获得租客候选。`,
  `- 市场池：${marketplaceCorpusStats.allowedListings} 套合规可用房源，${marketplaceCorpusStats.riskListings} 套风险或失效房源；交付非法候选 ${invalidCandidateCount} 个，公开日志私密边界泄露 ${privateLeakCount} 次。`,
  `- 本轮离线全链路耗时：${elapsedMs} ms。`,
  "",
  "## 本轮发现并修复的识别问题",
  "",
  "- 补充了“房东本人”“现在住这儿的租客”“个人转租”“自己的房子”等角色表达归一化。",
  "- 补充了 `元/月`、`RMB/月`、分隔符短句、先写封顶再写理想价等租金表达。",
  "- 扩充商圈与地铁词表，并支持“位置：”“帮我找 ×× 的房”等自然地点表达。",
  "- 通勤识别同时支持“分钟”“min”“最多 40 分钟”和分行字段。",
  "- 缺日期或只给模糊预算的输入不会猜值，而是保留为待追问字段。",
  "",
  "## 100 条房东 / 个人转租文案",
  ""
];

landlordResults.forEach(({ caseItem, parsed, passed }) => {
  const disposition = parsed.riskSignals.length ? `风险：${parsed.riskSignals.join("、")}` : parsed.missingFields.length ? `待补：${parsed.missingFields.join("、")}` : "可进入发布确认";
  lines.push(
    `### ${caseItem.id} · ${caseItem.style}${passed ? "" : " · 识别偏差"}`,
    "",
    "**输入**",
    "",
    quote(caseItem.input),
    "",
    "**输出**",
    "",
    `- 角色：${inline(parsed.fields.role)}；地点：${inline(parsed.fields.location)} / ${inline(parsed.fields.station)}；挂牌：${inline(parsed.fields.listedRent)}；底价：${inline(parsed.fields.minRent)}。`,
    `- 入住：${inline(parsed.fields.availableFrom)}；室友：${inline(parsed.fields.room.roommateCount)} 人 / ${inline(parsed.fields.room.roommateGender)}；处理：${disposition}。`,
    ""
  );
});

lines.push("## 100 条租户需求文案", "");

tenantResults.forEach(({ caseItem, parsed, passed }, index) => {
  const matchResult = demandMatchResults[index].result;
  const budget = parsed.fields.budget ? `${inline(parsed.fields.budget.target)}–${inline(parsed.fields.budget.hardMax)}` : "未识别";
  lines.push(
    `### ${caseItem.id} · ${caseItem.style}${passed ? "" : " · 识别偏差"}`,
    "",
    "**输入**",
    "",
    quote(caseItem.input),
    "",
    "**输出**",
    "",
    `- 地点：${inline(parsed.fields.locations)}；预算：${budget}；入住：${inline(parsed.fields.moveInWindow)}；通勤：${inline(parsed.fields.maxCommuteMinutes)} 分钟。`,
    `- 居住：${parsed.fields.sharedHousing === false ? "整租" : parsed.fields.roommateGender ? `${parsed.fields.roommateGender} 合租` : "可合租"}；待追问：${inline(parsed.coreMissing)}；匹配：扫描 ${matchResult.scanned} 套，交付 ${matchResult.candidates.length} 套。`,
    ""
  );
});

await fs.writeFile(casebookPath, `${lines.join("\n")}\n`, "utf8");

const failed = [
  ...landlordResults.filter((item) => !item.passed).map((item) => item.caseItem.id),
  ...tenantResults.filter((item) => !item.passed).map((item) => item.caseItem.id)
];
const summary = {
  landlordCases: landlordCopyCases.length,
  tenantCases: tenantCopyCases.length,
  landlordAccuracy: percent(landlordChecks.filter((item) => item.passed).length, landlordChecks.length),
  tenantAccuracy: percent(tenantChecks.filter((item) => item.passed).length, tenantChecks.length),
  demandPairs: totalDemandPairs,
  supplyPairs: totalSupplyPairs,
  matchedDemandCount,
  unmatchedDemandCount,
  invalidCandidateCount,
  privateLeakCount,
  failedCases: failed,
  casebookPath
};

console.log(JSON.stringify(summary, null, 2));
if (failed.length || invalidCandidateCount || privateLeakCount) process.exitCode = 1;
