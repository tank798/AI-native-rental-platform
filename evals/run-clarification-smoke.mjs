import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { clarificationPrompt } from "../src/ai/clarification-prompt.mjs";
import { parseClarificationModelOutput } from "../src/ai/clarification-schema.mjs";
import { readApiKey, SiliconFlowClient, siliconFlowDefaults } from "../src/ai/siliconflow-client.mjs";

const currentFile = fileURLToPath(import.meta.url);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const keyFile = argument("--key-file") || process.env.SILICONFLOW_API_KEY_FILE;
  const model = argument("--model") || process.env.SILICONFLOW_MODEL || siliconFlowDefaults.model;
  const apiKey = await readApiKey(keyFile);
  const client = new SiliconFlowClient({ apiKey, model });
  await client.assertModelAvailable();

  const expected = {
    fieldKey: "listing.fees.utilities",
    reasonCode: "TOTAL_COST_BLOCKING_UNKNOWN",
    expectedAnswerType: "enum",
    options: ["included", "actual_bill", "fixed_extra", "unknown"]
  };
  const prompt = clarificationPrompt({
    ...expected,
    templateQuestion: "水电燃气费是包含在月租中，还是按账单另付？",
    publicContext: { matchStatus: "clarifying" }
  });
  const output = await client.json({ stage: "clarification_contract_smoke", ...prompt, maxTokens: 500 });
  const parsed = parseClarificationModelOutput(output, expected);
  const usage = client.usageSummary();

  console.log(`澄清契约通过：${model}`);
  console.log(`问题：${parsed.question}`);
  console.log(`调用：${usage.calls}；总 tokens：${usage.total_tokens}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(`澄清契约失败：${error.message}`);
    process.exitCode = 1;
  });
}
