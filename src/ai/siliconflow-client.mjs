import fs from "node:fs/promises";

const DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1";
const DEFAULT_MODEL = "Qwen/Qwen3.5-35B-A3B";
const DEFAULT_TIMEOUT_MS = 20_000;
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
  if (!content) throw modelJsonError();
  try {
    return JSON.parse(content);
  } catch {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced.trim());
      } catch {
        throw modelJsonError();
      }
    }
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(content.slice(firstBrace, lastBrace + 1));
      } catch {
        throw modelJsonError();
      }
    }
    throw modelJsonError();
  }
}

function modelJsonError() {
  return Object.assign(new Error("模型返回的内容不是有效 JSON"), {
    code: "MODEL_INVALID_JSON"
  });
}

function publicProviderError(stage, cause) {
  const error = new Error(`[${stage}] AI 服务暂时不可用`);
  error.code = "AI_PROVIDER_ERROR";
  error.cause = cause;
  return error;
}

export class SiliconFlowClient {
  constructor({
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    model = DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    sleep = wait,
    random = Math.random,
    maxCallRecords = 100
  }) {
    if (!apiKey) throw new Error("缺少 SiliconFlow API Key");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.random = random;
    this.maxCallRecords = Math.max(1, Number(maxCallRecords) || 100);
    this.calls = [];
  }

  async listModels() {
    const response = await this.fetchImpl(`${this.baseUrl}/models`, {
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

  async json({ stage, system, user, temperature = 0.1, maxTokens = 4096, retries = 2 }) {
    const startedAt = Date.now();
    let lastError;
    let repairJson = false;
    const maxAttempts = Math.min(2, Math.max(1, Number(retries) || 2));

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              {
                role: "system",
                content: repairJson
                  ? `${system}\n\n上一次响应不是有效 JSON。请只返回严格合法的 JSON 对象。`
                  : system
              },
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
          const error = new Error(`SiliconFlow HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }

        let payload;
        try {
          payload = JSON.parse(raw);
        } catch {
          throw modelJsonError();
        }
        const content = payload?.choices?.[0]?.message?.content;
        const result = extractJson(content);
        this.calls.push({
          stage,
          attempt,
          model: this.model,
          status: "success",
          schema_success: true,
          latency_ms: Date.now() - startedAt,
          usage: payload.usage || null,
          trace_id: response.headers.get("x-siliconcloud-trace-id") || null
        });
        if (this.calls.length > this.maxCallRecords) {
          this.calls.splice(0, this.calls.length - this.maxCallRecords);
        }
        return result;
      } catch (error) {
        lastError = error;
        const invalidJson = error?.code === "MODEL_INVALID_JSON";
        const retryable = invalidJson
          || error?.name === "TimeoutError"
          || error?.name === "AbortError"
          || error instanceof TypeError
          || RETRYABLE_STATUS.has(error?.status);
        if (!retryable || attempt === maxAttempts) break;
        repairJson = invalidJson;
        const jitter = 0.75 + Math.max(0, Math.min(1, Number(this.random()) || 0)) * 0.5;
        await this.sleep(Math.round(650 * 2 ** (attempt - 1) * jitter));
      }
    }

    this.calls.push({
      stage,
      attempt: maxAttempts,
      model: this.model,
      status: "error",
      schema_success: lastError?.code !== "MODEL_INVALID_JSON",
      error_code: lastError?.code || (lastError?.status ? `HTTP_${lastError.status}` : "AI_PROVIDER_ERROR"),
      latency_ms: Date.now() - startedAt,
      usage: null,
      trace_id: null
    });
    if (this.calls.length > this.maxCallRecords) {
      this.calls.splice(0, this.calls.length - this.maxCallRecords);
    }
    throw publicProviderError(stage, lastError);
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
  model: DEFAULT_MODEL,
  timeoutMs: DEFAULT_TIMEOUT_MS
};
