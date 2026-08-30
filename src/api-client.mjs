const SESSION_KEY = "zhunaer-server-session-v1";
let sessionPromise = null;

function storedSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

async function responseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `请求失败：HTTP ${response.status}`);
    error.status = response.status;
    error.details = payload.details;
    throw error;
  }
  return payload;
}

export async function ensureServerSession() {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const existing = storedSession();
    if (existing?.token && existing?.userId) return existing;
    const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    return saveSession(await responseJson(response));
  })();
  try {
    return await sessionPromise;
  } catch (error) {
    sessionPromise = null;
    throw error;
  }
}

export async function getServerHealth() {
  const response = await fetch("/api/health", { cache: "no-store" });
  return responseJson(response);
}

async function apiRequest(path, options = {}, retried = false) {
  const session = await ensureServerSession();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && !retried) {
    localStorage.removeItem(SESSION_KEY);
    sessionPromise = null;
    return apiRequest(path, options, true);
  }
  return responseJson(response);
}

export function parseRenterWithServer(text, referenceDate) {
  return apiRequest("/api/intake/renter", {
    method: "POST",
    body: JSON.stringify({ text, referenceDate })
  });
}

export function parseSupplyWithServer(text, referenceDate) {
  return apiRequest("/api/intake/supply", {
    method: "POST",
    body: JSON.stringify({ text, referenceDate })
  });
}

export function createServerTask(kind, payload) {
  return apiRequest("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ kind, payload })
  });
}

export function listServerTasks() {
  return apiRequest("/api/tasks");
}

export function getServerTask(taskId) {
  return apiRequest(`/api/tasks/${encodeURIComponent(taskId)}`);
}

export function setServerTaskStatus(taskId, status) {
  return apiRequest(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

export async function uploadEvidenceFile(file, kind) {
  const data = await fileAsBase64(file);
  return apiRequest("/api/evidence", {
    method: "POST",
    body: JSON.stringify({ kind, name: file.name, mimeType: file.type, data })
  });
}
