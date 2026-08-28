import fs from "node:fs/promises";

const DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1";
const DEFAULT_MODEL = "Qwen/Qwen3.5-35B-A3B";
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanKey(rawValue) {
  const line = String(rawValue || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("#"));
  if (!line) throw new Error("API Key 文件为空");
  const value = line.includes("=") ? line.slice(line.indexOf("=") + 1).trim() : line;
  return value.replace(/^['"]|['"]$/g, "");
}

export async function readApiKey(keyFile) {
  if (!keyFile) throw new Error("缺少 API Key 文件路径；请设置 SILICONFLOW_API_KEY_FILE");
  return cleanKey(await fs.readFile(keyFile, "utf8"));
}

function extractJson(text) {
  const content = String(text || "").trim();
  if (!content) throw new Error("模型返回空内容");
  try {
    return JSON.parse(content);
  } catch {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced.trim());
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) return JSON.parse(content.slice(firstBrace, lastBrace + 1));
    throw new Error("模型返回的内容不是有效 JSON");
  }
}

export class SiliconFlowClient {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, model = DEFAULT_MODEL, timeoutMs = 120_000 }) {
    if (!apiKey) throw new Error("缺少 SiliconFlow API Key");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.calls = [];
  }

  async listModels() {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`模型列表请求失败：HTTP ${response.status}`);
    return response.json();
  }

  async assertModelAvailable() {
    const payload = await this.listModels();
    const models = Array.isArray(payload?.data) ? payload.data.map((item) => item.id) : [];
    if (!models.includes(this.model)) {
      throw new Error(`模型 ${this.model} 不在当前账号可用模型列表中`);
    }
    return { model: this.model, availableModels: models.length };
  }

  async json({ stage, system, user, temperature = 0.1, maxTokens = 4096, retries = 3 }) {
    const startedAt = Date.now();
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user }
            ],
            response_format: { type: "json_object" },
            enable_thinking: false,
            temperature,
            top_p: 0.8,
            max_tokens: maxTokens,
            stream: false
          }),
          signal: AbortSignal.timeout(this.timeoutMs)
        });

        const raw = await response.text();
        if (!response.ok) {
          const error = new Error(`SiliconFlow HTTP ${response.status}: ${raw.slice(0, 240)}`);
          error.status = response.status;
          throw error;
        }

        const payload = JSON.parse(raw);
        const content = payload?.choices?.[0]?.message?.content;
        const result = extractJson(content);
        this.calls.push({
          stage,
          attempt,
          latency_ms: Date.now() - startedAt,
          usage: payload.usage || null,
          trace_id: response.headers.get("x-siliconcloud-trace-id") || null
        });
        return result;
      } catch (error) {
        lastError = error;
        const retryable = error?.name === "TimeoutError" || RETRYABLE_STATUS.has(error?.status);
        if (!retryable || attempt === retries) break;
        await wait(650 * 2 ** (attempt - 1));
      }
    }

    throw new Error(`[${stage}] ${lastError?.message || "未知模型调用错误"}`);
  }

  usageSummary() {
    return this.calls.reduce(
      (summary, call) => {
        summary.calls += 1;
        summary.prompt_tokens += Number(call.usage?.prompt_tokens || 0);
        summary.completion_tokens += Number(call.usage?.completion_tokens || 0);
        summary.total_tokens += Number(call.usage?.total_tokens || 0);
        summary.total_latency_ms += Number(call.latency_ms || 0);
        return summary;
      },
      { calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, total_latency_ms: 0 }
    );
  }
}

export const siliconFlowDefaults = {
  baseUrl: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL
};
