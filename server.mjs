import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validateSupplyDraft } from "./src/simulation-engine.mjs";
import { openRentalDatabase } from "./src/server/database.mjs";
import { createIntakeService } from "./src/server/intake-service.mjs";
import { createMatchingService } from "./src/server/matching-service.mjs";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const JSON_LIMIT = 14 * 1024 * 1024;
const EVIDENCE_KINDS = new Set(["identity", "roleDocument", "rightsDocument", "livePhotoChallenge"]);
const MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"]
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isoDateAfter(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function text(response, status, body) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw Object.assign(new Error("请求内容过大"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("请求 JSON 无效"), { status: 400 });
  }
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

export function createRentalServer({
  databasePath = path.join(rootDir, "data", "rental.sqlite"),
  uploadRoot = path.join(rootDir, "data", "uploads"),
  aiApiKey = process.env.SILICONFLOW_API_KEY || null,
  aiKeyFile = process.env.SILICONFLOW_API_KEY_FILE || null,
  aiModel = process.env.SILICONFLOW_MODEL || undefined,
  enableScheduler = true,
  schedulerMs = 10_000
} = {}) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.mkdirSync(uploadRoot, { recursive: true });
  const repository = openRentalDatabase(databasePath);
  const matching = createMatchingService(repository);
  const intake = createIntakeService({ apiKey: aiApiKey, keyFile: aiKeyFile, model: aiModel });
  let scheduler = null;

  function sessionFor(request) {
    const authorization = String(request.headers.authorization || "");
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) return null;
    return repository.findProfileByTokenHash(sha256(token));
  }

  function requireSession(request) {
    const session = sessionFor(request);
    if (!session) throw Object.assign(new Error("会话无效，请重新进入应用"), { status: 401 });
    return session;
  }

  async function uploadEvidence(request, session) {
    const body = await readJson(request);
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
    return { id, kind: body.kind, uploaded: true };
  }

  function verifiedDraft(body, session) {
    const refs = body?.evidenceRefs || {};
    const draft = structuredClone(body?.draft || {});
    draft.evidenceRefs = {};
    draft.evidence = {};
    for (const kind of EVIDENCE_KINDS) {
      const evidence = refs[kind] ? repository.getEvidence(refs[kind], session.id) : null;
      const valid = Boolean(evidence && evidence.kind === kind);
      draft.evidence[kind] = valid;
      if (valid) draft.evidenceRefs[kind] = evidence.id;
    }
    return draft;
  }

  async function createTask(request, response, session) {
    const body = await readJson(request);
    if (!["renter", "supply"].includes(body.kind)) throw Object.assign(new Error("任务类型无效"), { status: 422 });
    const id = randomUUID();
    let payload;
    let label;
    if (body.kind === "renter") {
      const mandate = validateRenterPayload(body.payload);
      mandate.id = id;
      payload = { mandate, rawText: String(body.payload?.rawText || "") };
      label = mandate.locations.slice(0, 2).join(" / ");
    } else {
      const draft = verifiedDraft(body.payload, session);
      const validation = validateSupplyDraft(draft);
      if (!validation.valid) throw Object.assign(new Error(validation.errors[0]), { status: 422, details: validation.errors });
      payload = { draft, rawText: String(body.payload?.rawText || "") };
      label = draft.title || `${draft.location}个人房源`;
    }
    repository.createTask({ id, ownerId: session.id, kind: body.kind, label, payload, expiresAt: isoDateAfter(30) });
    matching.processAfterTaskCreated(id);
    const snapshot = matching.snapshot(id);
    return json(response, 201, { ...snapshot, task: publicTask(snapshot.task) });
  }

  async function handleApi(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, { ok: true, database: "sqlite", ai: intake.status(), continuousMatching: true });
    }
    if (request.method === "POST" && url.pathname === "/api/session") {
      const id = randomUUID();
      const token = randomBytes(32).toString("base64url");
      repository.createProfile({ id, tokenHash: sha256(token) });
      return json(response, 201, { userId: id, token });
    }

    const session = requireSession(request);
    repository.expireDueTasks();
    if (request.method === "POST" && url.pathname === "/api/intake/renter") {
      const body = await readJson(request);
      if (!String(body.text || "").trim()) throw Object.assign(new Error("找房描述不能为空"), { status: 422 });
      return json(response, 200, await intake.parseRenter(String(body.text), String(body.referenceDate)));
    }
    if (request.method === "POST" && url.pathname === "/api/intake/supply") {
      const body = await readJson(request);
      if (!String(body.text || "").trim()) throw Object.assign(new Error("房源描述不能为空"), { status: 422 });
      return json(response, 200, await intake.parseSupply(String(body.text), String(body.referenceDate)));
    }
    if (request.method === "POST" && url.pathname === "/api/evidence") {
      return json(response, 201, await uploadEvidence(request, session));
    }
    if (request.method === "POST" && url.pathname === "/api/tasks") return createTask(request, response, session);
    if (request.method === "GET" && url.pathname === "/api/tasks") {
      const tasks = repository.listTasksForOwner(session.id).map(publicTask);
      return json(response, 200, { tasks });
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const task = repository.getTask(taskMatch[1]);
      if (!task || task.ownerId !== session.id) return json(response, 404, { error: "任务不存在" });
      if (request.method === "GET") {
        const snapshot = matching.snapshot(task.id);
        return json(response, 200, { ...snapshot, task: publicTask(snapshot.task) });
      }
      if (request.method === "PATCH") {
        const body = await readJson(request);
        if (!["active", "paused", "closed"].includes(body.status)) throw Object.assign(new Error("任务状态无效"), { status: 422 });
        const updated = repository.setTaskStatus(task.id, session.id, body.status);
        if (body.status === "active") matching.processTask(task.id);
        return json(response, 200, { task: publicTask(updated) });
      }
    }
    return json(response, 404, { error: "API 不存在" });
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
        "Content-Type": contentTypes.get(path.extname(filename).toLowerCase()) || "application/octet-stream",
        "Content-Length": stat.size,
        "Cache-Control": filename.endsWith("service-worker.js") ? "no-cache" : "no-store",
        "X-Content-Type-Options": "nosniff"
      };
      response.writeHead(200, headers);
      if (request.method === "HEAD") return response.end();
      fs.createReadStream(filename).pipe(response);
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 500, { error: error.message, details: error.details || null });
      else response.destroy(error);
    }
  });

  return {
    server,
    repository,
    matching,
    intake,
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
