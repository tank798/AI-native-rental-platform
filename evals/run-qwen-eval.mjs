import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { renterCases, listingCases, goldenExpectations } from "./rental-eval-cases.mjs";
import {
  renterIntakePrompt,
  supplyNormalizePrompt,
  riskAuditPrompt,
  matchPrompt,
  negotiationPrompt,
  finalSelectionPrompt
} from "../src/ai/prompts.mjs";
import { readApiKey, SiliconFlowClient, siliconFlowDefaults } from "../src/ai/siliconflow-client.mjs";
import {
  enforceEvaluation,
  sanitizeNegotiations,
  enforceSelections,
  policyPrivateTerms,
  publicTextHasPrivateTerm
} from "../src/ai/policy-engine.mjs";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFile), "..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function requireArray(payload, key, expectedIds, idKey) {
  const value = payload?.[key];
  if (!Array.isArray(value)) throw new Error(`${key} 不是数组`);
  const ids = new Set(value.map((item) => item?.[idKey]));
  const missing = expectedIds.filter((id) => !ids.has(id));
  if (missing.length) throw new Error(`${key} 缺少：${missing.join(", ")}`);
  return value;
}

function withoutPrivateFloor(listing) {
  const { private_min_rent: _privateMinRent, ...publicListing } = listing;
  return publicListing;
}

function valueById(items, idKey, id) {
  return items.find((item) => item?.[idKey] === id);
}

export function riskScore(decisions) {
  const expected = new Map();
  Object.entries(goldenExpectations.risk).forEach(([decision, ids]) => {
    ids.forEach((id) => expected.set(id, decision));
  });
  const rows = [...expected].map(([listingId, expectedDecision]) => {
    const actualDecision = valueById(decisions, "listing_id", listingId)?.decision || "missing";
    return { listing_id: listingId, expected: expectedDecision, actual: actualDecision, pass: actualDecision === expectedDecision };
  });
  return { passed: rows.filter((row) => row.pass).length, total: rows.length, rows };
}

export function selectionScore(selections) {
  const rows = Object.entries(goldenExpectations.expectedTop).map(([renterId, expectedTop]) => {
    const selection = valueById(selections, "renter_id", renterId);
    const actualTop = selection?.recommendations?.[0]?.listing_id || null;
    return { renter_id: renterId, expected: expectedTop, actual: actualTop, pass: actualTop === expectedTop };
  });
  return { passed: rows.filter((row) => row.pass).length, total: rows.length, rows };
}

export function invariantChecks({ renters, listings, decisions, matches, negotiations, selections }) {
  const allowedIds = new Set(decisions.filter((item) => item.decision === "allow").map((item) => item.listing_id));
  const eligiblePairs = new Set(
    matches.flatMap((match) =>
      (match.evaluations || [])
        .filter((evaluation) => evaluation.eligible)
        .map((evaluation) => `${match.renter_id}:${evaluation.listing_id}`)
    )
  );
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });

  for (const selection of selections) {
    const recommendations = Array.isArray(selection.recommendations) ? selection.recommendations : [];
    add(`${selection.renter_id} 最多三套`, recommendations.length <= 3, `实际 ${recommendations.length} 套`);
    recommendations.forEach((recommendation) => {
      add(
        `${selection.renter_id}/${recommendation.listing_id} 风控准入`,
        allowedIds.has(recommendation.listing_id),
        allowedIds.has(recommendation.listing_id) ? "allow" : "非 allow 房源进入推荐"
      );
      add(
        `${selection.renter_id}/${recommendation.listing_id} 硬筛通过`,
        eligiblePairs.has(`${selection.renter_id}:${recommendation.listing_id}`),
        eligiblePairs.has(`${selection.renter_id}:${recommendation.listing_id}`) ? "eligible" : "未通过硬筛"
      );
    });
  }

  for (const [renterId, listingId, reason] of goldenExpectations.mustRejectPairs) {
    const decision = valueById(decisions, "listing_id", listingId)?.decision;
    const evaluation = valueById(matches, "renter_id", renterId)?.evaluations?.find((item) => item.listing_id === listingId);
    const rejected = reason === "risk" || reason === "stale" ? decision !== "allow" : evaluation?.eligible === false;
    add(`${renterId}/${listingId} 必须淘汰`, rejected, reason);
  }

  for (const result of negotiations) {
    const renter = valueById(renters, "renter_id", result.renter_id);
    const listing = valueById(listings, "listing_id", result.listing_id);
    if (result.status === "tentative_agreement") {
      add(
        `${result.renter_id}/${result.listing_id} 未超租客授权`,
        Number(result.agreed_rent) <= Number(renter?.budget?.max),
        `意向 ${result.agreed_rent} / 上限 ${renter?.budget?.max}`
      );
      add(
        `${result.renter_id}/${result.listing_id} 未越出租方授权`,
        Number(result.agreed_rent) >= Number(listing?.private_min_rent),
        `意向 ${result.agreed_rent}`
      );
    }
    add(`${result.renter_id}/${result.listing_id} 模型泄露标记`, result.private_data_leaked === false, String(result.private_data_leaked));
  }

  const publicPayload = JSON.stringify({ matches, negotiations, selections });
  const leakTerms = policyPrivateTerms;
  leakTerms.forEach((term) => add(`公开结果不含“${term}”`, !publicPayload.includes(term), "公开字段扫描"));

  const renterR01 = valueById(renters, "renter_id", "R01");
  add("R01 最高预算无误", renterR01?.budget?.max === 3300, String(renterR01?.budget?.max));
  const listingH04 = valueById(listings, "listing_id", "H04");
  add("H04 识别收费角色风险", listingH04?.role === "broker" || listingH04?.risk_signals?.length > 0, listingH04?.role || "missing");

  return checks;
}

function percent(value, total) {
  return total ? `${Math.round((value / total) * 100)}%` : "—";
}

export function reportMarkdown({ model, startedAt, finishedAt, availability, usage, risk, selection, checks, selections, negotiations, sanitizedLeakCount }) {
  const invariantPassed = checks.filter((item) => item.pass).length;
  const status = risk.passed === risk.total && selection.passed === selection.total && invariantPassed === checks.length ? "PASS" : "NEEDS REVIEW";
  const selectionRows = selection.rows
    .map((row) => `| ${row.renter_id} | ${row.expected ?? "无合适房源"} | ${row.actual ?? "无合适房源"} | ${row.pass ? "通过" : "失败"} |`)
    .join("\n");
  const failedChecks = checks.filter((item) => !item.pass);
  const failureSection = failedChecks.length
    ? failedChecks.map((item) => `- ${item.name}：${item.detail}`).join("\n")
    : "- 无";
  const matchedCount = selections.filter((item) => item.status === "matched").length;

  return `# 栖合 Qwen 真实链路评测

**结论：${status}**

- 模型：${model}
- 执行时间：${startedAt} — ${finishedAt}
- 模型可用性：已在账号模型列表中确认（共 ${availability.availableModels} 个可用模型）
- 数据集：10 位租客 × 10 套房源
- 调用：${usage.calls} 次；输入 ${usage.prompt_tokens} tokens；输出 ${usage.completion_tokens} tokens；合计 ${usage.total_tokens} tokens
- 累计模型等待：${(usage.total_latency_ms / 1000).toFixed(1)} 秒

## 关键结果

- 风控判定：${risk.passed}/${risk.total}（${percent(risk.passed, risk.total)}）
- 首选结果：${selection.passed}/${selection.total}（${percent(selection.passed, selection.total)}）
- 规则断言：${invariantPassed}/${checks.length}（${percent(invariantPassed, checks.length)}）
- 有结果：${matchedCount}/10；无合适房源：${10 - matchedCount}/10；触发议价：${negotiations.length} 组
${sanitizedLeakCount ? `- 模型公开措辞触碰隐私边界：${sanitizedLeakCount} 组；出站策略层已拦截并改写` : "- 公开措辞隐私泄露：0 组"}

## 每位租客的首选

| 租客 | 期望 | 实际 | 结果 |
|---|---|---|---|
${selectionRows}

## 未通过项

${failureSection}

## 安全边界

- API Key 只在进程内读取，没有写入仓库、报告或前端。
- 模型的隐藏推理与 reasoning_content 不保存；报告只记录可审计决定。
- 公开输出扫描私密字段名和“底价/预算上限”等泄露措辞。
`;
}

async function main() {
  const keyFile = argument("--key-file") || process.env.SILICONFLOW_API_KEY_FILE;
  const model = argument("--model") || process.env.SILICONFLOW_MODEL || siliconFlowDefaults.model;
  const apiKey = await readApiKey(keyFile);
  const client = new SiliconFlowClient({ apiKey, model });
  const startedAt = new Date().toISOString();

  console.log(`[0/6] 确认可用模型：${model}`);
  const availability = await client.assertModelAvailable();

  console.log("[1/6] 结构化 10 位租客委托");
  const renterPrompt = renterIntakePrompt(renterCases);
  const renterPayload = await client.json({ stage: "renter_intake", ...renterPrompt, maxTokens: 4096 });
  const renters = requireArray(renterPayload, "renters", renterCases.map((item) => item.id), "renter_id");

  console.log("[2/6] 结构化 10 套供给");
  const supplyPrompt = supplyNormalizePrompt(listingCases);
  const supplyPayload = await client.json({ stage: "supply_normalize", ...supplyPrompt, maxTokens: 4096 });
  const listings = requireArray(supplyPayload, "listings", listingCases.map((item) => item.id), "listing_id");

  console.log("[3/6] 独立风控核验");
  const riskPrompt = riskAuditPrompt(listings);
  const riskPayload = await client.json({ stage: "risk_audit", ...riskPrompt, maxTokens: 2400 });
  const decisions = requireArray(riskPayload, "decisions", listingCases.map((item) => item.id), "listing_id");
  const allowedIds = new Set(decisions.filter((item) => item.decision === "allow").map((item) => item.listing_id));
  const allowedListings = listings.filter((listing) => allowedIds.has(listing.listing_id));

  console.log(`[4/6] 为 10 位租客匹配 ${allowedListings.length} 套准入房源`);
  const matches = [];
  let sanitizedLeakCount = 0;
  for (const renter of renters) {
    const prompt = matchPrompt(renter, allowedListings);
    const payload = await client.json({ stage: `match_${renter.renter_id}`, ...prompt, maxTokens: 2500 });
    if (!Array.isArray(payload?.evaluations)) throw new Error(`${renter.renter_id} evaluations 不是数组`);
    sanitizedLeakCount += payload.evaluations.filter((item) =>
      publicTextHasPrivateTerm({ public_reason: item.public_reason, evidence: item.evidence })
    ).length;
    const evaluations = allowedListings.map((listing) => {
      const rawEvaluation = payload.evaluations.find((item) => item.listing_id === listing.listing_id) || {
        listing_id: listing.listing_id,
        eligible: false,
        hard_conflicts: ["model_omitted"],
        unknowns: [],
        preference_score: 0,
        needs_negotiation: false,
        public_reason: "模型没有返回该房源的判断。",
        evidence: []
      };
      return enforceEvaluation(renter, listing, rawEvaluation);
    });
    matches.push({ renter_id: renter.renter_id, evaluations });
    console.log(`      ${renter.renter_id} 完成`);
  }

  const pairKeys = new Set();
  const pairs = [];
  for (const match of matches) {
    const renter = valueById(renters, "renter_id", match.renter_id);
    for (const evaluation of match.evaluations || []) {
      if (!evaluation.eligible) continue;
      const listing = valueById(allowedListings, "listing_id", evaluation.listing_id);
      const overBudget = Number(listing?.listed_rent) > Number(renter?.budget?.max);
      if (!evaluation.needs_negotiation && !overBudget) continue;
      const pairKey = `${match.renter_id}:${evaluation.listing_id}`;
      if (pairKeys.has(pairKey)) continue;
      pairKeys.add(pairKey);
      pairs.push({
        renter_id: match.renter_id,
        listing_id: evaluation.listing_id,
        target_rent: renter?.budget?.target,
        private_max_rent: renter?.budget?.max,
        listed_rent: listing?.listed_rent,
        private_min_rent: listing?.private_min_rent,
        authorized_conditions: ["rent", "move_in_date", "lease_term"]
      });
    }
  }

  console.log(`[5/6] 异步议价 ${pairs.length} 组`);
  let negotiations = [];
  if (pairs.length) {
    const prompt = negotiationPrompt(pairs);
    const payload = await client.json({ stage: "negotiation", ...prompt, maxTokens: 3000 });
    if (!Array.isArray(payload?.negotiations)) throw new Error("negotiations 不是数组");
    const returnedPairs = new Set(payload.negotiations.map((item) => `${item.renter_id}:${item.listing_id}`));
    const missingPairs = pairs
      .map((pair) => `${pair.renter_id}:${pair.listing_id}`)
      .filter((pairId) => !returnedPairs.has(pairId));
    if (missingPairs.length) throw new Error(`negotiations 缺少：${missingPairs.join(", ")}`);
    const sanitized = sanitizeNegotiations(payload.negotiations, pairs);
    negotiations = sanitized.negotiations;
    sanitizedLeakCount += sanitized.leakCount;
  }

  console.log("[6/6] 生成每位租客最多三套的最终结果");
  const finalPrompt = finalSelectionPrompt({
    renters,
    listings: allowedListings.map(withoutPrivateFloor),
    matches,
    negotiations
  });
  const finalPayload = await client.json({ stage: "final_selection", ...finalPrompt, maxTokens: 4096 });
  const rawSelections = requireArray(finalPayload, "selections", renterCases.map((item) => item.id), "renter_id");
  sanitizedLeakCount += rawSelections.filter((item) => publicTextHasPrivateTerm(item)).length;
  const selections = enforceSelections({ selections: rawSelections, decisions, matches, negotiations });

  const risk = riskScore(decisions);
  const selection = selectionScore(selections);
  const checks = invariantChecks({ renters, listings, decisions, matches, negotiations, selections });
  const usage = client.usageSummary();
  const finishedAt = new Date().toISOString();
  const summary = reportMarkdown({ model, startedAt, finishedAt, availability, usage, risk, selection, checks, selections, negotiations, sanitizedLeakCount });
  const resultsDir = path.join(rootDir, "evals", "results");
  await fs.mkdir(resultsDir, { recursive: true });
  await fs.writeFile(path.join(resultsDir, "latest-summary.md"), summary, "utf8");
  await fs.writeFile(
    path.join(resultsDir, "latest.json"),
    `${JSON.stringify({ model, startedAt, finishedAt, availability, usage, risk, selection, checks, sanitizedLeakCount, renters, listings, decisions, matches, negotiations, selections, calls: client.calls }, null, 2)}\n`,
    "utf8"
  );

  console.log(`完成：风控 ${risk.passed}/${risk.total}，首选 ${selection.passed}/${selection.total}，规则 ${checks.filter((item) => item.pass).length}/${checks.length}`);
  console.log("报告：evals/results/latest-summary.md");
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(`评测失败：${error.message}`);
    process.exitCode = 1;
  });
}
