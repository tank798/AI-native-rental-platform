import { createHash, randomBytes, randomUUID } from "node:crypto";

const COOKIE_NAME = "zhunaer_session";
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cookieValue(cookieHeader, name) {
  const pairs = String(cookieHeader || "").split(";");
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return null;
}

/**
 * Owns anonymous local-alpha sessions. Raw secrets only cross the boundary in
 * HttpOnly cookies; SQLite stores their SHA-256 hashes and expiry state.
 */
export function createSessionService({
  repository,
  now = () => new Date(),
  ttlMs = DEFAULT_TTL_MS,
  secureCookies = false
}) {
  if (!repository) throw new Error("createSessionService 需要 repository");

  function serializeCookie(token, maxAgeSeconds) {
    const attributes = [
      `${COOKIE_NAME}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${maxAgeSeconds}`
    ];
    if (secureCookies) attributes.push("Secure");
    return attributes.join("; ");
  }

  return {
    createAnonymousSession() {
      const issuedAt = now();
      const profileId = randomUUID();
      const sessionId = randomBytes(16).toString("hex");
      const token = randomBytes(32).toString("base64url");
      const tokenHash = sha256(token);
      const expiresAt = new Date(issuedAt.getTime() + ttlMs).toISOString();

      // profiles.token_hash remains populated during the v0.6→v0.7 migration;
      // authentication itself is performed exclusively against sessions.
      repository.createProfile({ id: profileId, tokenHash: `profile:${tokenHash}` });
      repository.createSession({
        id: sessionId,
        profileId,
        tokenHash,
        createdAt: issuedAt.toISOString(),
        expiresAt
      });
      return {
        profileId,
        sessionId,
        publicSession: { userId: profileId, expiresAt },
        setCookie: serializeCookie(token, Math.max(1, Math.floor(ttlMs / 1000)))
      };
    },

    authenticateCookie(cookieHeader) {
      const token = cookieValue(cookieHeader, COOKIE_NAME);
      if (!token) return null;
      const at = now().toISOString();
      const session = repository.findSessionByTokenHash(sha256(token), at);
      if (!session) return null;
      repository.touchSession(session.id, at);
      return session;
    },

    revokeSession(sessionId) {
      return repository.revokeSession(sessionId, now().toISOString());
    },

    clearCookie() {
      return serializeCookie("", 0);
    }
  };
}
