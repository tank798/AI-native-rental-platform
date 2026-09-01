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
import { createEventService } from "./src/server/event-service.mjs";
import { createMatchingService } from "./src/server/matching-service.mjs";
import { createMediaRepository } from "./src/server/media-repository.mjs";
import { createMediaService } from "./src/server/media-service.mjs";
import { createMatchingWorker } from "./src/server/matching-worker.mjs";
import { createOutboxRepository } from "./src/server/outbox-repository.mjs";
import { createNotificationService } from "./src/server/notification-service.mjs";
import { createRateLimiter } from "./src/server/rate-limit.mjs";
import { parseContactEncryptionKey } from "./src/server/contact-service.mjs";
import { assertSameOrigin, httpError, readJson } from "./src/server/request-guards.mjs";
import { normalizeMarketMode, readRuntimeConfig } from "./src/server/runtime-config.mjs";
import { parseIntakeRequest, parseTaskCreateRequest } from "./src/server/schemas.mjs";
import { createSessionService } from "./src/server/session-service.mjs";
import { createVerificationService } from "./src/server/verification-service.mjs";
import { createViewingService } from "./src/server/viewing-service.mjs";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_JSON_LIMIT = 12 * 1024 * 1024;
const MEDIA_JSON_LIMIT = 12 * 1024 * 1024;
const EVIDENCE_KINDS = new Set(["identity", "roleDocument", "rightsDocument", "livePhotoChallenge"]);
const REPORT_REASONS = new Set(["broker_or_fee", "mismatch", "stolen_photo", "unavailable", "safety", "other"]);
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

async function sendMedia(request, response, descriptor) {
  const stat = await fsPromises.stat(descriptor.path).catch(() => null);
  if (!stat?.isFile()) throw httpError(404, "MEDIA_NOT_FOUND", "公开房源照片不存在");
  const headers = {
    ...securityHeaders(),
    "Content-Type": descriptor.mimeType,
    "Content-Length": stat.size,
    "Cache-Control": "private, no-store",
    ETag: descriptor.etag
  };
  if (request.headers["if-none-match"] === descriptor.etag) {
    response.writeHead(304, { ...securityHeaders(), "Cache-Control": headers["Cache-Control"], ETag: descriptor.etag });
    return response.end();
  }
  response.writeHead(200, headers);
  fs.createReadStream(descriptor.path).pipe(response);
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
    expiresAt: task.expiresAt,
    lifecycleVersion: task.lifecycleVersion
  };
}

function clarificationCategory(reasonCode) {
  const reason = String(reasonCode || "");
  if (/(?:ROLE|RIGHTS|VERIFICATION|SAFETY|IDENTITY)/u.test(reason)) return "资格与安全";
  if (/(?:LOCATION|CITY|COMMUTE|MOVE_IN|REQUIRED_FACILITY|HOUSING)/u.test(reason)) return "核心居住条件";
  if (/(?:BUDGET|RENT|LEASE|FEE|TOTAL_COST)/u.test(reason)) return "价格与租期";
  if (/(?:ROOMMATE|VIEWING|SCHEDULE)/u.test(reason)) return "居住与看房安排";
  return "其他匹配条件";
}

function publicTermsChanges(previous, current) {
  const labels = {
    rent: "月租",
    leaseMonths: "租期",
    moveInWindow: "入住日期",
    feeSummary: "费用规则",
    approximateLocation: "大致位置",
    viewingAvailability: "看房安排",
    highlights: "房源要点"
  };
  return Object.keys(labels)
    .filter((key) => JSON.stringify(previous?.[key] ?? null) !== JSON.stringify(current?.[key] ?? null))
    .map((key) => labels[key]);
}

/** Builds the same owner-scoped case view for GET and mutation responses. */
function publicMatchCase(matching, matchCase, ownerId) {
  const decisionState = matching.confirmations.status(matchCase.id, ownerId);
  const party = matching.matchCaseRepository.participantParty(matchCase.id, ownerId);
  const open = matching.matchCaseRepository
    .listClarifications(matchCase.id)
    .filter((item) => item.status === "open");
  const ownQuestions = open
    .filter((item) => item.targetParty === party)
    .map((item) => ({
      id: item.id,
      fieldKey: item.fieldKey,
      question: item.question,
      category: clarificationCategory(item.reasonCode),
      priority: item.priority,
      answerSpec: item.answerSpec,
      createdAt: item.createdAt
    }));
  const otherQuestions = open.filter((item) => item.targetParty !== party);
  const confirmationHistory = matching.matchCaseRepository
    .listConfirmations(matchCase.id)
    .filter((item) => item.party === party && item.revokedAt)
    .sort((left, right) => right.confirmedAt.localeCompare(left.confirmedAt));
  const previousConfirmation = decisionState.myDecision === "pending" ? confirmationHistory[0] : null;
  const previousTerms = previousConfirmation
    ? matching.matchCaseRepository.listTerms(matchCase.id).find((item) => item.version === previousConfirmation.termsVersion)
    : null;
  return {
    id: matchCase.id,
    status: matchCase.status,
    myParty: party,
    myDecision: decisionState.myDecision,
    otherDecision: decisionState.otherDecision,
    currentTerms: matchCase.terms ? {
      version: matchCase.terms.version,
      hash: matchCase.terms.hash,
      publicTerms: matchCase.terms.publicTerms,
      nonBlockingUnknowns: matchCase.terms.nonBlockingUnknowns
    } : null,
    contactUnlocked: matching.contactGrants.isUnlocked(matchCase.id, ownerId),
    requiresReconfirmation: Boolean(previousConfirmation),
    termsChangeSummary: previousConfirmation
      ? publicTermsChanges(previousTerms?.publicTerms, matchCase.terms?.publicTerms)
      : [],
    clarifications: {
      questions: ownQuestions,
      otherPendingCount: otherQuestions.length,
      otherPendingCategories: [...new Set(otherQuestions.map((item) => clarificationCategory(item.reasonCode)))]
    },
    expiresAt: matchCase.expiresAt,
    updatedAt: matchCase.updatedAt
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
  // 供应商变慢时应当能靠配置调整，而不是改代码重新发版。
  const aiTimeoutMs = Number(options.aiTimeoutMs ?? environment.SILICONFLOW_TIMEOUT_MS) || undefined;
  const contactEncryptionKey = options.contactEncryptionKey ?? environment.CONTACT_ENCRYPTION_KEY ?? null;
  const enableScheduler = options.enableScheduler ?? true;
  const schedulerMs = options.schedulerMs ?? 10_000;
  const marketMode = normalizeMarketMode(options.marketMode ?? runtimeConfig.marketMode);
  const secureCookies = options.secureCookies ?? environment.NODE_ENV === "production";
  const rateLimitPolicy = rateLimitPolicyFrom(environment, options.rateLimitPolicy);
  const clock = options.clock || createClock();

  if (marketMode === "real") parseContactEncryptionKey(contactEncryptionKey);

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.mkdirSync(uploadRoot, { recursive: true });
  const repository = openRentalDatabase(databasePath, { clock });
  const events = createEventService({ database: repository, clock });
  const verification = createVerificationService({ repository, clock });
  const mediaRepository = createMediaRepository({ database: repository, clock });
  const media = createMediaService({ mediaRepository, uploadRoot, clock });
  const matching = createMatchingService(repository, {
    marketMode,
    clock,
    contactEncryptionKey,
    onContactSecurityError: options.onContactSecurityError,
    mediaRepository,
    eventService: events
  });
  const notifications = createNotificationService({ database: repository, clock });
  const viewings = createViewingService({
    database: repository,
    matchCaseRepository: matching.matchCaseRepository,
    contactGrantService: matching.contactGrants,
    eventService: events,
    notificationService: notifications,
    clock
  });
  const reportStatements = {
    insert: repository.raw.prepare(`
      INSERT INTO reports(id, match_case_id, reporter_owner_id, reason_code, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
    `),
    byId: repository.raw.prepare("SELECT * FROM reports WHERE id = ?")
  };
  const outbox = createOutboxRepository({ database: repository, clock, ...(options.outboxOptions || {}) });
  const worker = createMatchingWorker({
    outboxRepository: outbox,
    matchingService: matching,
    clock,
    ...(options.workerOptions || {})
  });
  matching.clarifications.setRecalculate(() => worker.drain());
  const sessions = createSessionService({ repository, secureCookies, now: clock.now });
  const rateLimiter = options.rateLimiter || createRateLimiter({ now: clock.nowMs });
  const intake = createIntakeService({
    apiKey: aiApiKey,
    keyFile: aiKeyFile,
    model: aiModel,
    timeoutMs: aiTimeoutMs,
    clientOptions: options.aiClientOptions || {}
  });
  let scheduler = null;
  let maintenancePromise = null;

  function runMaintenance() {
    if (maintenancePromise) return maintenancePromise;
    maintenancePromise = (async () => {
      try {
        outbox.requeueExpired();
        repository.expireDueTasks();
        outbox.compensateUnmatched({ olderThanMs: Math.max(60_000, schedulerMs * 6) });
        worker.drain();
        matching.contactGrants.cleanupExpired();
        viewings.cancelInvalid();
        notifications.syncAll();
        repository.cleanupExpiredSessions();
        await media.cleanupPending();
      } catch (error) {
        console.error("持续匹配失败", error);
      } finally {
        maintenancePromise = null;
      }
    })();
    return maintenancePromise;
  }

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
    const created = repository.createTaskIdempotent({
      id,
      ownerId: session.id,
      kind: body.kind,
      label,
      payload,
      expiresAt: isoTimestampAfterDays(clock, 14),
      clientRequestId: body.clientRequestId
    });
    worker.drain();
    if (created.created) events.record({
      type: "task.activated",
      aggregateId: created.task.id,
      actorOwnerId: session.id,
      payload: { kind: created.task.kind, inputVersion: created.task.inputVersion, lifecycleVersion: created.task.lifecycleVersion },
      dedupeKey: `task-activated:${created.task.id}:${created.task.lifecycleVersion}`,
      createdAt: created.task.createdAt
    });
    notifications.syncOwner(session.id);
    const snapshot = matching.snapshot(created.task.id);
    return json(response, created.created ? 201 : 200, {
      ...snapshot,
      task: publicTask(snapshot.task),
      idempotent: !created.created
    });
  }

  async function handleApi(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/health") {
      const workerHealth = worker.health();
      const ok = workerHealth.failed === 0;
      return json(response, ok ? 200 : 503, {
        ok,
        database: "sqlite",
        databaseHealth: { status: "healthy", engine: "sqlite" },
        worker: { status: ok ? "healthy" : "degraded", ...workerHealth },
        ai: intake.status(),
        continuousMatching: true,
        marketMode,
        demoBanner: marketMode === "demo"
      });
    }
    if (request.method === "POST" && url.pathname === "/api/session") {
      assertSameOrigin(request);
      await readJson(request);
      const existing = sessionFor(request);
      if (existing) {
        return json(response, 200, { userId: existing.id, expiresAt: existing.expiresAt });
      }
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
    const mediaReadRoute = url.pathname.match(/^\/api\/media\/([^/]+)$/);
    if (request.method === "GET" && mediaReadRoute) {
      const descriptor = media.getReadable(decodeURIComponent(mediaReadRoute[1]), session.id);
      return sendMedia(request, response, descriptor);
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

    if (url.pathname === "/api/notifications") {
      if (request.method === "GET") return json(response, 200, notifications.list(session.id));
      if (request.method === "POST") {
        assertSameOrigin(request);
        const body = await readJson(request);
        if (body.action !== "mark_all_read") throw httpError(422, "NOTIFICATION_ACTION_INVALID", "通知操作无效");
        notifications.markAllRead(session.id);
        return json(response, 200, notifications.list(session.id));
      }
    }
    const notificationReadRoute = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (request.method === "POST" && notificationReadRoute) {
      assertSameOrigin(request);
      await readJson(request);
      const item = notifications.markRead(decodeURIComponent(notificationReadRoute[1]), session.id);
      if (!item) return json(response, 404, { error: "通知不存在", code: "NOTIFICATION_NOT_FOUND" });
      return json(response, 200, { notification: item, unreadCount: notifications.unreadCount(session.id) });
    }

    if (url.pathname === "/api/profile/contact") {
      if (request.method === "GET") {
        return json(response, 200, { contact: matching.contacts.getMasked(session.id) });
      }
      if (request.method === "PUT") {
        assertSameOrigin(request);
        enforceWriteLimit(request, session);
        const body = await readJson(request);
        return json(response, 200, { contact: matching.contacts.set(session.id, body) });
      }
    }

    const mediaUploadRoute = url.pathname.match(/^\/api\/tasks\/([^/]+)\/media$/);
    if (request.method === "POST" && mediaUploadRoute) {
      assertSameOrigin(request);
      enforceWriteLimit(request, session);
      const taskId = decodeURIComponent(mediaUploadRoute[1]);
      const body = await readJson(request, { limitBytes: MEDIA_JSON_LIMIT });
      const result = await media.uploadPublic({
        taskId,
        ownerId: session.id,
        mimeType: body.mimeType,
        data: body.data,
        alt: body.alt,
        publicConsent: body.publicConsent
      });
      if (!result.duplicate) {
        repository.bumpTaskInputVersion(taskId, session.id, "task.media_changed");
        worker.drain();
      }
      return json(response, result.duplicate ? 200 : 201, result);
    }

    const taskMatchesRoute = url.pathname.match(/^\/api\/tasks\/([^/]+)\/matches$/);
    if (request.method === "GET" && taskMatchesRoute) {
      const taskId = decodeURIComponent(taskMatchesRoute[1]);
      const task = repository.getTask(taskId);
      if (!task || task.ownerId !== session.id) return json(response, 404, { error: "任务不存在", code: "TASK_NOT_FOUND" });
      const matches = matching.matchCaseRepository
        .listForTask(taskId)
        .map((matchCase) => publicMatchCase(matching, matchCase, session.id));
      return json(response, 200, { matches });
    }

    const matchDecisionRoute = url.pathname.match(/^\/api\/matches\/([^/]+)\/(confirm|decline)$/);
    if (request.method === "POST" && matchDecisionRoute) {
      assertSameOrigin(request);
      enforceWriteLimit(request, session);
      const body = await readJson(request);
      const input = {
        matchCaseId: decodeURIComponent(matchDecisionRoute[1]),
        ownerId: session.id,
        termsVersion: body.termsVersion,
        termsHash: body.termsHash
      };
      const decision = matchDecisionRoute[2] === "confirm"
        ? matching.confirmations.confirm(input)
        : matching.confirmations.decline(input);
      notifications.syncAll();
      return json(response, 200, {
        matchCase: publicMatchCase(matching, decision.matchCase, session.id),
        idempotent: decision.idempotent
      });
    }

    const matchContactRoute = url.pathname.match(/^\/api\/matches\/([^/]+)\/contact$/);
    if (request.method === "GET" && matchContactRoute) {
      const result = matching.contactGrants.getForOwner(decodeURIComponent(matchContactRoute[1]), session.id);
      notifications.syncOwner(session.id);
      return json(response, 200, result);
    }

    const matchViewingRoute = url.pathname.match(/^\/api\/matches\/([^/]+)\/viewings$/);
    if (matchViewingRoute) {
      const matchCaseId = decodeURIComponent(matchViewingRoute[1]);
      if (request.method === "GET") return json(response, 200, { appointments: viewings.listForCase(matchCaseId, session.id) });
      if (request.method === "POST") {
        assertSameOrigin(request);
        enforceWriteLimit(request, session);
        const body = await readJson(request);
        return json(response, 201, viewings.propose({ matchCaseId, ownerId: session.id, startsAt: body.startsAt }));
      }
    }
    const viewingDecisionRoute = url.pathname.match(/^\/api\/viewings\/([^/]+)\/(accept|reject)$/);
    if (request.method === "POST" && viewingDecisionRoute) {
      assertSameOrigin(request);
      enforceWriteLimit(request, session);
      await readJson(request);
      return json(response, 200, viewings.respond({
        appointmentId: decodeURIComponent(viewingDecisionRoute[1]),
        ownerId: session.id,
        decision: viewingDecisionRoute[2] === "accept" ? "accepted" : "rejected"
      }));
    }

    const matchReportRoute = url.pathname.match(/^\/api\/matches\/([^/]+)\/reports$/);
    if (request.method === "POST" && matchReportRoute) {
      assertSameOrigin(request);
      enforceWriteLimit(request, session);
      const matchCaseId = decodeURIComponent(matchReportRoute[1]);
      if (!matching.matchCaseRepository.getForOwner(matchCaseId, session.id)) return json(response, 404, { error: "匹配案例不存在", code: "MATCH_CASE_NOT_FOUND" });
      const body = await readJson(request);
      const reasonCode = String(body.reasonCode || "");
      if (!REPORT_REASONS.has(reasonCode)) throw httpError(422, "REPORT_REASON_INVALID", "举报原因无效");
      const description = String(body.description || "").trim().slice(0, 500);
      const id = randomUUID();
      const at = clock.nowIso();
      reportStatements.insert.run(id, matchCaseId, session.id, reasonCode, description, at, at);
      events.record({ type: "report.created", aggregateId: matchCaseId, actorOwnerId: session.id, payload: { reasonCode }, dedupeKey: `report:${id}`, createdAt: at });
      return json(response, 201, { report: { id, matchCaseId, reasonCode, description, status: "open", createdAt: at } });
    }

    const clarificationAnswerMatch = url.pathname.match(/^\/api\/matches\/([^/]+)\/clarifications\/([^/]+)\/answers$/);
    if (request.method === "POST" && clarificationAnswerMatch) {
      assertSameOrigin(request);
      enforceWriteLimit(request, session);
      const matchCaseId = decodeURIComponent(clarificationAnswerMatch[1]);
      const clarificationId = decodeURIComponent(clarificationAnswerMatch[2]);
      const body = await readJson(request);
      const answered = await matching.clarifications.answer({
        matchCaseId,
        clarificationId,
        ownerId: session.id,
        rawAnswer: body.answer
      });
      events.record({
        type: "clarification.completed",
        aggregateId: matchCaseId,
        actorOwnerId: session.id,
        payload: {
          party: matching.matchCaseRepository.participantParty(matchCaseId, session.id),
          questionCount: 1,
          latencyMs: Math.max(0, Date.parse(clock.nowIso()) - Date.parse(answered.answer?.createdAt || clock.nowIso()))
        },
        dedupeKey: `clarification-completed:${clarificationId}`
      });
      notifications.syncAll();
      const matchCase = matching.matchCaseRepository.getForOwner(matchCaseId, session.id);
      return json(response, 200, {
        matchCase: publicMatchCase(matching, matchCase, session.id),
        answer: { clarificationId, idempotent: answered.idempotent }
      });
    }

    const matchCaseMatch = url.pathname.match(/^\/api\/matches\/([^/]+)$/);
    if (request.method === "GET" && matchCaseMatch) {
      const matchCase = matching.matchCaseRepository.getForOwner(decodeURIComponent(matchCaseMatch[1]), session.id);
      if (!matchCase) return json(response, 404, { error: "匹配案例不存在", code: "MATCH_CASE_NOT_FOUND" });
      return json(response, 200, { matchCase: publicMatchCase(matching, matchCase, session.id) });
    }

    const taskRenewRoute = url.pathname.match(/^\/api\/tasks\/([^/]+)\/renew$/);
    if (request.method === "POST" && taskRenewRoute) {
      assertSameOrigin(request);
      enforceWriteLimit(request, session);
      await readJson(request);
      const taskId = decodeURIComponent(taskRenewRoute[1]);
      const task = repository.getTask(taskId);
      if (!task || task.ownerId !== session.id) return json(response, 404, { error: "任务不存在", code: "TASK_NOT_FOUND" });
      const base = Math.max(clock.now().getTime(), Date.parse(task.expiresAt));
      const expiresAt = new Date(base + 14 * 24 * 60 * 60 * 1000).toISOString();
      const updated = repository.renewTask(taskId, session.id, expiresAt);
      events.record({
        type: "task.renewed",
        aggregateId: taskId,
        actorOwnerId: session.id,
        payload: { inputVersion: updated.inputVersion, lifecycleVersion: updated.lifecycleVersion, expiresAt },
        dedupeKey: `task-renewed:${taskId}:${updated.lifecycleVersion}`
      });
      worker.drain();
      viewings.cancelInvalid();
      notifications.syncOwner(session.id);
      return json(response, 200, { task: publicTask(updated) });
    }

    const taskCloneRoute = url.pathname.match(/^\/api\/tasks\/([^/]+)\/clone$/);
    if (request.method === "POST" && taskCloneRoute) {
      assertSameOrigin(request);
      enforceWriteLimit(request, session);
      await readJson(request);
      const source = repository.getTask(decodeURIComponent(taskCloneRoute[1]));
      if (!source || source.ownerId !== session.id) return json(response, 404, { error: "任务不存在", code: "TASK_NOT_FOUND" });
      const id = randomUUID();
      const payload = { ...structuredClone(source.payload), inputVersion: 1 };
      const created = repository.createTaskIdempotent({ id, ownerId: session.id, kind: source.kind, label: source.label, payload, inputVersion: 1, expiresAt: isoTimestampAfterDays(clock, 14), clientRequestId: randomUUID() });
      events.record({ type: "task.activated", aggregateId: id, actorOwnerId: session.id, payload: { kind: source.kind, inputVersion: 1, lifecycleVersion: 1 }, dedupeKey: `task-activated:${id}:1` });
      worker.drain();
      return json(response, 201, { ...matching.snapshot(id), task: publicTask(created.task) });
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
        worker.drain();
        viewings.cancelInvalid();
        if (body.status === "active") events.record({
          type: "task.activated",
          aggregateId: task.id,
          actorOwnerId: session.id,
          payload: { kind: updated.kind, inputVersion: updated.inputVersion, lifecycleVersion: updated.lifecycleVersion },
          dedupeKey: `task-reactivated:${task.id}:${updated.inputVersion}`
        });
        else events.record({
          type: `task.${body.status}`,
          aggregateId: task.id,
          actorOwnerId: session.id,
          payload: { inputVersion: updated.inputVersion },
          dedupeKey: `task-${body.status}:${task.id}:${updated.inputVersion}`
        });
        notifications.syncAll();
        return json(response, 200, { task: publicTask(updated) });
      }
      if (request.method === "DELETE") {
        assertSameOrigin(request);
        enforceWriteLimit(request, session);
        repository.setTaskStatus(task.id, session.id, "closed");
        worker.drain();
        const queuedMedia = media.deleteForTask(task.id, session.id);
        repository.deleteTask(task.id, session.id);
        return json(response, 200, { deleted: true, queuedMedia });
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
    events,
    notifications,
    viewings,
    verification,
    media,
    mediaRepository,
    outbox,
    worker,
    clock,
    intake,
    sessions,
    rateLimiter,
    async listen(port = 4173, host = "127.0.0.1") {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      worker.drain();
      if (enableScheduler) {
        scheduler = setInterval(() => void runMaintenance(), schedulerMs);
        scheduler.unref();
      }
      return server.address();
    },
    async close() {
      if (scheduler) clearInterval(scheduler);
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      if (maintenancePromise) await maintenancePromise;
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
