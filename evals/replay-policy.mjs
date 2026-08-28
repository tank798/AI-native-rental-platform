import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  enforceEvaluation,
  enforceSelections,
  publicTextHasPrivateTerm
} from "../src/ai/policy-engine.mjs";
import {
  riskScore,
  selectionScore,
  invariantChecks,
  reportMarkdown
} from "./run-qwen-eval.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonPath = path.join(rootDir, "evals", "results", "latest.json");
const summaryPath = path.join(rootDir, "evals", "results", "latest-summary.md");

function byId(items, key, id) {
  return items.find((item) => item?.[key] === id);
}

async function main() {
  const data = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  let newlySanitized = 0;

  const matches = data.matches.map((match) => {
    const renter = byId(data.renters, "renter_id", match.renter_id);
    const evaluations = match.evaluations.map((evaluation) => {
      if (publicTextHasPrivateTerm({ public_reason: evaluation.public_reason, evidence: evaluation.evidence })) newlySanitized += 1;
      const listing = byId(data.listings, "listing_id", evaluation.listing_id);
      return enforceEvaluation(renter, listing, evaluation);
    });
    return { ...match, evaluations };
  });

  newlySanitized += data.selections.filter((selection) => publicTextHasPrivateTerm(selection)).length;
  const selections = enforceSelections({
    selections: data.selections,
    decisions: data.decisions,
    matches,
    negotiations: data.negotiations
  });
  const risk = riskScore(data.decisions);
  const selection = selectionScore(selections);
  const checks = invariantChecks({
    renters: data.renters,
    listings: data.listings,
    decisions: data.decisions,
    matches,
    negotiations: data.negotiations,
    selections
  });
  const sanitizedLeakCount = Number(data.sanitizedLeakCount || 0) + newlySanitized;
  const availability = data.availability || { availableModels: 92 };
  const summary = reportMarkdown({
    model: data.model,
    startedAt: data.startedAt,
    finishedAt: data.finishedAt,
    availability,
    usage: data.usage,
    risk,
    selection,
    checks,
    selections,
    negotiations: data.negotiations,
    sanitizedLeakCount
  });

  const replayed = {
    ...data,
    availability,
    risk,
    selection,
    checks,
    sanitizedLeakCount,
    matches,
    selections,
    policyReplayedAt: new Date().toISOString()
  };
  await fs.writeFile(jsonPath, `${JSON.stringify(replayed, null, 2)}\n`, "utf8");
  await fs.writeFile(summaryPath, summary, "utf8");
  console.log(`策略重放完成：风控 ${risk.passed}/${risk.total}，首选 ${selection.passed}/${selection.total}，规则 ${checks.filter((item) => item.pass).length}/${checks.length}`);
  console.log(`脱敏改写：${newlySanitized} 组`);
}

main().catch((error) => {
  console.error(`策略重放失败：${error.message}`);
  process.exitCode = 1;
});
