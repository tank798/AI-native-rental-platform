export function httpError(status, code, message, details = null) {
  return Object.assign(new Error(message), { status, code, details });
}

/** Rejects state-changing JSON requests that use an unexpected media type. */
export function assertJsonContentType(request) {
  const contentType = String(request.headers?.["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw httpError(415, "UNSUPPORTED_MEDIA_TYPE", "请求必须使用 application/json");
  }
}

/**
 * Checks browser Origin against Host before a cookie-authenticated mutation.
 * Native clients and same-host tests may omit Origin; browsers send it for the
 * JSON writes protected by this guard.
 */
export function assertSameOrigin(request) {
  const host = String(request.headers?.host || "").trim().toLowerCase();
  const origin = String(request.headers?.origin || "").trim();

  // Sec-Fetch-Site 由浏览器强制添加且不可被脚本伪造，优先采信。
  const fetchSite = String(request.headers?.["sec-fetch-site"] || "").trim().toLowerCase();
  if (fetchSite) {
    if (fetchSite === "same-origin" || fetchSite === "none") return;
    throw httpError(403, "ORIGIN_MISMATCH", "请求来源与当前站点不一致");
  }

  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      throw httpError(403, "ORIGIN_MISMATCH", "请求来源无效");
    }
    if (!host || originHost !== host) {
      throw httpError(403, "ORIGIN_MISMATCH", "请求来源与当前站点不一致");
    }
    return;
  }

  // 既无 Sec-Fetch-Site 也无 Origin 时回退校验 Referer。
  // 旧实现在这里直接 return，导致只要不带 Origin 就能绕过全部同源校验。
  const referer = String(request.headers?.referer || "").trim();
  if (referer) {
    let refererHost;
    try {
      refererHost = new URL(referer).host.toLowerCase();
    } catch {
      throw httpError(403, "ORIGIN_MISMATCH", "请求来源无效");
    }
    if (!host || refererHost !== host) {
      throw httpError(403, "ORIGIN_MISMATCH", "请求来源与当前站点不一致");
    }
    return;
  }

  throw httpError(403, "ORIGIN_REQUIRED", "写操作必须携带可校验的同源来源信息");
}

/** Reads and parses a JSON stream while enforcing the route-specific byte cap. */
export async function readJson(request, { limitBytes = 64 * 1024 } = {}) {
  assertJsonContentType(request);
  const declaredLength = Number(request.headers?.["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    request.resume?.();
    throw httpError(413, "REQUEST_TOO_LARGE", "请求内容过大");
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    function cleanup() {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("aborted", onAborted);
      request.removeListener("error", onError);
    }

    function fail(error, drain = false) {
      cleanup();
      if (drain) request.resume?.();
      reject(error);
    }

    function onData(chunk) {
      size += chunk.length;
      if (size > limitBytes) {
        fail(httpError(413, "REQUEST_TOO_LARGE", "请求内容过大"), true);
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      cleanup();
      if (!chunks.length) return resolve({});
      try {
        return resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        return reject(httpError(400, "INVALID_JSON", "请求 JSON 无效"));
      }
    }

    function onAborted() {
      fail(httpError(400, "REQUEST_ABORTED", "请求在读取完成前中断"));
    }

    function onError() {
      fail(httpError(400, "REQUEST_ABORTED", "请求在读取完成前中断"));
    }

    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
  });
}
