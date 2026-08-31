import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClock, isoTimestampAfterDays } from "./src/clock.mjs";
import { validateSupplyDraft } from "./src/simulation-engine.mjs";
import { parseSupplyText } from "./src/supply-parser.mjs";
import { openRentalDatabase } from "./src/server/database.mjs";
import { createIntakeService } from "./src/server/intake-service.mjs";
import { createMatchingService } from "./src/server/matching-service.mjs";
import { createRateLimiter } from "./src/server/rate-limit.mjs";
import { assertSameOrigin, httpError, readJson } from "./src/server/request-guards.mjs";
import { normalizeMarketMode, readRuntimeConfig } from "./src/server/runtime-config.mjs";
import { parseIntakeRequest, parseTaskCreateRequest } from "./src/server/schemas.mjs";
import { createSessionService } from "./src/server/session-service.mjs";
import { createVerificationService } from "./src/server/verification-service.mjs";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_JSON_LIMIT = 12 * 1024 * 1024;
const EVIDENCE_KINDS = new Set(["identity", "roleDocument", "rightsDocument", "livePhotoChallenge"]);
const MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"]
]);
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join("; ");
const DEFAULT_RATE_LIMIT_POLICY = {
  sessionIpMinute: { limit: 10, windowMs: 60_000 },
  writeIpMinute: { limit: 60, windowMs: 60_000 },
  writeProfileMinute: { limit: 30, windowMs: 60_000 },
  writeProfileDay: { limit: 1_000, windowMs: 24 * 60 * 60_000 },
  aiIpMinute: { limit: 10, windowMs: 60_000 },
  aiSessionMinute: { limit: 6, windowMs: 60_000 },
  aiProfileHour: { limit: 30, windowMs: 60 * 60_000 },
  aiProfileDay: { limit: 100, windowMs: 24 * 60 * 60_000 },
  aiGlobalDay: { limit: 1_000, windowMs: 24 * 60 * 60_000 }
};
const RATE_LIMIT_ENV = {
  sessionIpMinute: ["RATE_SESSION_IP_MINUTE", 100],
  writeIpMinute: ["RATE_WRITE_IP_MINUTE", 600],
  writeProfileMinute: ["RATE_WRITE_PROFILE_MINUTE", 300],
  writeProfileDay: ["RATE_WRITE_PROFILE_DAY", 10_000],
  aiIpMinute: ["RATE_AI_IP_MINUTE", 60],
  aiSessionMinute: ["RATE_AI_SESSION_MINUTE", 30],
  aiProfileHour: ["RATE_AI_PROFILE_HOUR", 500],
  aiProfileDay: ["RATE_AI_PROFILE_DAY", 1_000],
  aiGlobalDay: ["RATE_AI_GLOBAL_DAY", 20_000]
};

function rateLimitPolicyFrom(environment, overrides = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_RATE_LIMIT_POLICY).map(([key, defaults]) => {
    const [environmentKey, hardMax] = RATE_LIMIT_ENV[key];
    const requested = overrides[key]?.limit ?? environment[environmentKey] ?? defaults.limit;
    const parsed = Number(requested);
    const limit = Number.isFinite(parsed) ? Math.min(hardMax, Math.max(1, Math.floor(parsed))) : defaults.limit;
    const requestedWindow = Number(overrides[key]?.windowMs ?? defaults.windowMs);
    const windowMs = Number.isFinite(requestedWindow)
      ? Math.min(7 * 24 * 60 * 60_000, Math.max(1_000, Math.floor(requestedWindow)))
      : defaults.windowMs;
    return [key, { limit, windowMs }];
  }));
}

function securityHeaders() {
  return {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(self), geolocation=(), microphone=()"
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function json(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  response.end(body);
}

function text(response, status, body) {
  response.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function publicTask(task) {
  return {
    id: task.id,
    kind: task.kind,
    status: task.status,
    label: task.label,
    scanned: task.scanned,
    suitable: task.suitable,
    runCount: task.runCount,
    candidateVersion: task.candidateVersion,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    lastMatchAt: task.lastMatchAt,
    expiresAt: task.expiresAt
  };
}

function validateRenterPayload(payload) {
  const mandate = structuredClone(payload?.mandate || {});
  const errors = [];
  mandate.locations = Array.isArray(mandate.locations)
    ? mandate.locations.map((location) => String(location || "").trim()).filter(Boolean)
    : [];
  const target = Number(mandate.budget?.target);
  const hardMax = Number(mandate.budget?.hardMax);
  if (!mandate.locations.length) errors.push("需要至少一个找房区域");
  if (!Number.isFinite(target) || !Number.isFinite(hardMax) || target <= 0 || hardMax <= 0) errors.push("需要完整预算区间");
  if (target > hardMax) errors.push("目标预算不能高于最高预算");
  if (!mandate.moveInWindow?.from || !mandate.moveInWindow?.to) errors.push("需要完整入住日期范围");
  if (!Number.isFinite(Number(mandate.maxCommuteMinutes)) || Number(mandate.maxCommuteMinutes) < 15 || Number(mandate.maxCommuteMinutes) > 60) errors.push("需要最长通勤时间");
  if (errors.length) throw Object.assign(new Error(errors[0]), { status: 422, details: errors });
  return mandate;
}

function safeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  if (decoded === "/" || decoded === "/index.html") return path.join(rootDir, "index.html");
  const allowed = ["/assets/", "/src/", "/manifest.webmanifest", "/service-worker.js"];
  if (!allowed.some((prefix) => decoded === prefix || decoded.startsWith(prefix))) return null;
  const resolved = path.resolve(rootDir, `.${decoded}`);
  return resolved.startsWith(`${rootDir}${path.sep}`) ? resolved : null;
}

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".webmanifest", "application/manifest+json; charset=utf-8"]
]);

export function createRentalServer(options = {}) {
  const environment = options.environment || process.env;
  const runtimeConfig = readRuntimeConfig(environment);
  const databasePath = options.databasePath || runtimeConfig.databasePath || path.join(rootDir, "data", "rental.sqlite");
  const uploadRoot = options.uploadRoot || runtimeConfig.uploadDirectory || path.join(rootDir, "data", "uploads");
  const aiApiKey = options.aiApiKey ?? environment.SILICONFLOW_API_KEY ?? null;
  const aiKeyFile = options.aiKeyFile ?? environment.SILICONFLOW_API_KEY_FILE ?? null;
  const aiModel = options.aiModel ?? environment.SILICONFLOW_MODEL ?? undefined;
  const enableScheduler = options.enableScheduler ?? true;
  const schedulerMs = options.schedulerMs ?? 10_000;
  const marketMode = normalizeMarketMode(options.marketMode ?? runtimeConfig.marketMode);
  const secureCookies = options.secureCookies ?? environment.NODE_ENV === "production";
  const rateLimitPolicy = rateLimitPolicyFrom(environment, options.rateLimitPolicy);
  const clock = options.clock || createClock();

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.mkdirSync(uploadRoot, { recursive: true });
  const repository = openRentalDatabase(databasePath, { clock });
  const verification = createVerificationService({ repository, clock });
  const matching = createMatchingService(repository, { marketMode, clock });
  const sessions = createSessionService({ repository, secureCookies, now: clock.now });
  const rateLimiter = options.rateLimiter || createRateLimiter({ now: clock.nowMs });
  const intake = createIntakeService({
    apiKey: aiApiKey,
    keyFile: aiKeyFile,
    model: aiModel,
    clientOptions: options.aiClientOptions || {}
  });
  let scheduler = null;

  function sessionFor(request) {
    const session = sessions.authenticateCookie(request.headers.cookie);
    if (!session) return null;
    return { id: session.profileId, sessionId: session.sessionId, expiresAt: session.expiresAt };
  }

  function requireSession(request) {
    const session = sessionFor(request);
    if (!session) throw httpError(401, "SESSION_INVALID", "会话无效，请重新进入应用");
    return session;
  }

  function requestIp(request) {
    return String(request.socket?.remoteAddress || "unknown");
  }

  function rateRule(scope, key, policy) {
    return { scope, key, limit: policy.limit, windowMs: policy.windowMs };
  }

  function enforceRateLimit(rules) {
    const result = rateLimiter.consume(rules);
    if (result.allowed) return;
    const error = httpError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试", { scope: result.scope });
    error.headers = { "Retry-After": String(result.retryAfterSeconds) };
    throw error;
  }

  function enforceSessionCreationLimit(request) {
    enforceRateLimit([
      rateRule("session:ip:minute", requestIp(request), rateLimitPolicy.sessionIpMinute)
    ]);
  }

  function enforceWriteLimit(request, session) {
    enforceRateLimit([
      rateRule("write:ip:minute", requestIp(request), rateLimitPolicy.writeIpMinute),
      rateRule("write:profile:minute", session.id, rateLimitPolicy.writeProfileMinute),
      rateRule("write:profile:day", session.id, rateLimitPolicy.writeProfileDay)
    ]);
  }

  function enforceAiLimit(request, session) {
    const result = rateLimiter.consume([
      rateRule("ai:global:day", "all", rateLimitPolicy.aiGlobalDay),
      rateRule("ai:ip:minute", requestIp(request), rateLimitPolicy.aiIpMinute),
      rateRule("ai:session:minute", session.sessionId, rateLimitPolicy.aiSessionMinute),
      rateRule("ai:profile:hour", session.id, rateLimitPolicy.aiProfileHour),
      rateRule("ai:profile:day", session.id, rateLimitPolicy.aiProfileDay)
    ]);
    if (result.allowed) return { degraded: false };
    if (result.scope === "ai:global:day") return { degraded: true };
    const error = httpError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试", { scope: result.scope });
    error.headers = { "Retry-After": String(result.retryAfterSeconds) };
    throw error;
  }

  async function uploadEvidence(request, session) {
    const body = await readJson(request, { limitBytes: EVIDENCE_JSON_LIMIT });
    if (!EVIDENCE_KINDS.has(body.kind)) throw Object.assign(new Error("材料类型无效"), { status: 422 });
    const mimeType = String(body.mimeType || "").toLowerCase();
    const extension = MIME_EXTENSIONS.get(mimeType);
    if (!extension) throw Object.assign(new Error("只支持 JPG、PNG、WebP 或 PDF"), { status: 415 });
    const buffer = Buffer.from(String(body.data || ""), "base64");
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw Object.assign(new Error("材料大小需在 1B 到 8MB 之间"), { status: 422 });
    const id = randomUUID();
    const ownerDir = path.join(uploadRoot, session.id);
    await fsPromises.mkdir(ownerDir, { recursive: true });
    const storagePath = path.join(ownerDir, `${id}${extension}`);
    await fsPromises.writeFile(storagePath, buffer, { mode: 0o600 });
    repository.addEvidence({
      id,
      ownerId: session.id,
      kind: body.kind,
      storagePath,
      originalName: String(body.name || `material${extension}`).slice(0, 180),
      mimeType,
      sha256: sha256(buffer)
    });
    const status = verification.statusFor(id, session.id);
    return { id, kind: body.kind, uploaded: true, ...status };
  }

  function verifiedDraft(body, session) {
    const refs = body?.evidenceRefs || {};
    const draft = structuredClone(body?.draft || {});
    draft.evidenceRefs = {};
    // Client-supplied verification claims are discarded. Only persisted review
    // records owned by this session can become verification facts on the task.
    draft.verification = {};
    for (const kind of EVIDENCE_KINDS) {
      const evidence = refs[kind] ? repository.getEvidence(refs[kind], session.id) : null;
      const valid = Boolean(evidence && evidence.kind === kind);
      if (!valid) continue;
      draft.evidenceRefs[kind] = evidence.id;
      draft.verification[kind] = verification.statusFor(evidence.id, session.id);
    }
    return draft;
  }

  async function createTask(request, response, session) {
    const body = parseTaskCreateRequest(await readJson(request));
    const id = randomUUID();
    let payload;
    let label;
    if (body.kind === "renter") {
      const mandate = validateRenterPayload(body.payload);
      mandate.id = id;
      payload = {
        mandate,
        rawText: body.payload.rawText,
        inputVersion: body.payload.inputVersion,
        fieldStates: body.payload.fieldStates
      };
      label = mandate.locations.slice(0, 2).join(" / ");
    } else {
      const rawSupply = parseSupplyText(body.payload.rawText, clock.todayInShanghai());
      const criticalRisk = rawSupply.riskSignals.filter((signal) => ["broker_role", "role_conflict", "prohibited_fee"].includes(signal));
      if (criticalRisk.length) {
        throw httpError(422, "SUPPLY_RISK_REJECTED", "只接受房东本人或当前租客的零收费房源", { reasonCodes: criticalRisk });
      }
      const draft = verifiedDraft(body.payload, session);
      const validation = validateSupplyDraft(draft, { clock });
      if (!validation.valid) throw Object.assign(new Error(validation.errors[0]), { status: 422, details: validation.errors });
      payload = {
        draft,
        rawText: body.payload.rawText,
        inputVersion: body.payload.inputVersion,
        fieldStates: body.payload.fieldStates
      };
      label = draft.title || `${draft.location}个人房源`;
    }
    repository.createTask({ id, ownerId: session.id, kind: body.kind, label, payload, expiresAt: isoTimestampAfterDays(clock, 30) });
    matching.processAfterTaskCreated(id);
    const snapshot = matching.snapshot(id);
    return json(response, 201, { ...snapshot, task: publicTask(snapshot.task) });
  }

  async function handleApi(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, {
        ok: true,
        database: "sqlite",
        ai: intake.status(),
        continuousMatching: true,
        marketMode,
        demoBanner: marketMode === "demo"
      });
    }
    if (request.method === "POST" && url.pathname === "/api/session") {
      assertSameOrigin(request);
      await readJson(request);
      enforceSessionCreationLimit(request);
      const issued = sessions.createAnonymousSession();
      return json(response, 201, issued.publicSession, { "Set-Cookie": issued.setCookie });
    }

    const session = requireSession(request);
    if (request.method === "DELETE" && url.pathname === "/api/session") {
      assertSameOrigin(request);
      sessions.revokeSession(session.sessionId);
      return json(response, 200, { revoked: true }, { "Set-Cookie": sessions.clearCookie() });
    }
    repository.expireDueTasks();
    if (request.method === "POST" && url.pathname === "/api/intake/renter") {
      assertSameOrigin(request);
      const body = parseIntakeRequest(await readJson(request));
      const budget = enforceAiLimit(request, session);
      if (budget.degraded) return json(response, 200, intake.parseRenterDeterministic(body.text, body.referenceDate));
      return json(response, 200, await intake.parseRenter(body.text, body.referenceDate));
    }
    if (request.method === "POST" && url.pathname === "/api/intake/supply") {
      assertSameOrigin(request);
      const body = parseIntakeRequest(await readJson(request));
      const budget = enforceAiLimit(request, session);
      if (budget.degraded) return json(response, 200, intake.parseSupplyDeterministic(body.text, body.referenceDate));
      return json(response, 200, await intake.parseSupply(body.text, body.referenceDate));
    }
    if (request.method === "POST" && url.pathname === "/api/evidence") {
      assertSameOrigin(request);
      enforceWriteLimit(request, session);
      return json(response, 201, await uploadEvidence(request, session));
    }
    const evidenceMatch = url.pathname.match(/^\/api\/evidence\/([^/]+)$/);
    if (request.method === "GET" && evidenceMatch) {
      const status = verification.statusFor(decodeURIComponent(evidenceMatch[1]), session.id);
      if (!status) return json(response, 404, { error: "材料不存在", code: "EVIDENCE_NOT_FOUND" });
      return json(response, 200, status);
    }
    if (request.method === "POST" && url.pathname === "/api/tasks") {
      assertSameOrigin(request);
      enforceWriteLimit(request, session);
      return createTask(request, response, session);
    }
    if (request.method === "GET" && url.pathname === "/api/tasks") {
      const tasks = repository.listTasksForOwner(session.id).map(publicTask);
      return json(response, 200, { tasks });
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const task = repository.getTask(taskMatch[1]);
      if (!task || task.ownerId !== session.id) return json(response, 404, { error: "任务不存在", code: "TASK_NOT_FOUND" });
      if (request.method === "GET") {
        const snapshot = matching.snapshot(task.id);
        return json(response, 200, { ...snapshot, task: publicTask(snapshot.task) });
      }
      if (request.method === "PATCH") {
        assertSameOrigin(request);
        enforceWriteLimit(request, session);
        const body = await readJson(request);
        if (!["active", "paused", "closed"].includes(body.status)) throw Object.assign(new Error("任务状态无效"), { status: 422 });
        const updated = repository.setTaskStatus(task.id, session.id, body.status);
        matching.processTask(task.id);
        return json(response, 200, { task: publicTask(updated) });
      }
    }
    return json(response, 404, { error: "API 不存在", code: "API_NOT_FOUND" });
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
      if (request.method !== "GET" && request.method !== "HEAD") return text(response, 405, "Method Not Allowed");
      const filename = safeStaticPath(url.pathname);
      if (!filename) return text(response, 404, "Not Found");
      const stat = await fsPromises.stat(filename).catch(() => null);
      if (!stat?.isFile()) return text(response, 404, "Not Found");
      const headers = {
        ...securityHeaders(),
        "Content-Type": contentTypes.get(path.extname(filename).toLowerCase()) || "application/octet-stream",
        "Content-Length": stat.size,
        "Cache-Control": filename.endsWith("service-worker.js") ? "no-cache" : "no-store"
      };
      response.writeHead(200, headers);
      if (request.method === "HEAD") return response.end();
      fs.createReadStream(filename).pipe(response);
    } catch (error) {
      if (!response.headersSent) {
        const status = error.status || 500;
        json(response, status, {
          error: status >= 500 ? "服务暂时不可用" : error.message,
          code: error.code || (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED"),
          details: status >= 500 ? null : error.details || null
        }, error.headers || {});
      }
      else response.destroy(error);
    }
  });

  return {
    server,
    repository,
    matching,
    verification,
    clock,
    intake,
    sessions,
    rateLimiter,
    async listen(port = 4173, host = "127.0.0.1") {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      if (enableScheduler) {
        scheduler = setInterval(() => {
          try {
            matching.processAllActive();
          } catch (error) {
            console.error("持续匹配失败", error);
          }
        }, schedulerMs);
        scheduler.unref();
      }
      return server.address();
    },
    async close() {
      if (scheduler) clearInterval(scheduler);
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      repository.close();
    }
  };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  const app = createRentalServer();
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || "127.0.0.1";
  app.listen(port, host)
    .then(() => {
      const ai = app.intake.status();
      console.log(`住哪儿服务已启动：http://${host}:${port}`);
      console.log(`市场模式：${app.matching.marketMode === "demo" ? "演示语料" : "真实用户任务"}`);
      console.log(ai.configured ? `运行时 AI：${ai.model}` : "运行时 AI：确定性安全模式（配置 SILICONFLOW_API_KEY_FILE 可启用模型）");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
