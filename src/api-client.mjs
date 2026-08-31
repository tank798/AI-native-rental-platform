let sessionPromise = null;

async function responseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `请求失败：HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.code;
    error.details = payload.details;
    throw error;
  }
  return payload;
}

export async function ensureServerSession() {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const response = await fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    return responseJson(response);
  })();
  try {
    return await sessionPromise;
  } catch (error) {
    sessionPromise = null;
    throw error;
  }
}

export async function getServerHealth() {
  const response = await fetch("/api/health", { cache: "no-store", credentials: "same-origin" });
  return responseJson(response);
}

export async function revokeServerSession() {
  const response = await fetch("/api/session", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" }
  });
  sessionPromise = null;
  return responseJson(response);
}

async function apiRequest(path, options = {}, retried = false) {
  await ensureServerSession();
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && !retried) {
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

export function getProfileContact() {
  return apiRequest("/api/profile/contact");
}

export function setProfileContact(type, value) {
  return apiRequest("/api/profile/contact", {
    method: "PUT",
    body: JSON.stringify({ type, value })
  });
}

export function getServerTask(taskId) {
  return apiRequest(`/api/tasks/${encodeURIComponent(taskId)}`);
}

export function getMatchCase(matchCaseId) {
  return apiRequest(`/api/matches/${encodeURIComponent(matchCaseId)}`);
}

export function listTaskMatches(taskId) {
  return apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/matches`);
}

export function confirmMatchCase(matchCaseId, termsVersion, termsHash) {
  return apiRequest(`/api/matches/${encodeURIComponent(matchCaseId)}/confirm`, {
    method: "POST",
    body: JSON.stringify({ termsVersion, termsHash })
  });
}

export function declineMatchCase(matchCaseId, termsVersion, termsHash) {
  return apiRequest(`/api/matches/${encodeURIComponent(matchCaseId)}/decline`, {
    method: "POST",
    body: JSON.stringify({ termsVersion, termsHash })
  });
}

export function getMatchContact(matchCaseId) {
  return apiRequest(`/api/matches/${encodeURIComponent(matchCaseId)}/contact`);
}

export function answerMatchClarification(matchCaseId, clarificationId, answer) {
  return apiRequest(`/api/matches/${encodeURIComponent(matchCaseId)}/clarifications/${encodeURIComponent(clarificationId)}/answers`, {
    method: "POST",
    body: JSON.stringify({ answer })
  });
}

export function setServerTaskStatus(taskId, status) {
  return apiRequest(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function deleteServerTask(taskId) {
  return apiRequest(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
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

export async function uploadListingMedia(taskId, file, alt) {
  const data = await fileAsBase64(file);
  return apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/media`, {
    method: "POST",
    body: JSON.stringify({
      mimeType: file.type,
      data,
      alt,
      publicConsent: true
    })
  });
}

export function getEvidenceStatus(evidenceId) {
  return apiRequest(`/api/evidence/${encodeURIComponent(evidenceId)}`);
}
