import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { openRentalDatabase } from "../src/server/database.mjs";
import { createSessionService } from "../src/server/session-service.mjs";

test("会话只把原始 secret 放进 HttpOnly Cookie，并可按服务端时钟过期", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-session-service-"));
  const repository = openRentalDatabase(path.join(tempDir, "rental.sqlite"));
  let nowMs = Date.parse("2026-08-30T00:00:00.000Z");
  const sessions = createSessionService({
    repository,
    now: () => new Date(nowMs),
    ttlMs: 60_000,
    secureCookies: true
  });
  t.after(async () => {
    repository.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const issued = sessions.createAnonymousSession();

  assert.match(issued.setCookie, /^zhunaer_session=/);
  assert.match(issued.setCookie, /HttpOnly/);
  assert.match(issued.setCookie, /SameSite=Lax/);
  assert.match(issued.setCookie, /Secure/);
  assert.equal(issued.publicSession.token, undefined);
  assert.equal(issued.publicSession.userId, issued.profileId);
  assert.match(issued.sessionId, /^[a-f0-9]{32}$/);
  const rawToken = issued.setCookie.match(/^zhunaer_session=([^;]+)/)?.[1];
  const stored = repository.raw.prepare("SELECT token_hash FROM sessions WHERE id = ?").get(issued.sessionId);
  assert.notEqual(stored.token_hash, rawToken);
  assert.match(stored.token_hash, /^[a-f0-9]{64}$/);

  const authenticated = sessions.authenticateCookie(issued.setCookie.split(";", 1)[0]);
  assert.equal(authenticated.profileId, issued.profileId);
  assert.equal(authenticated.sessionId, issued.sessionId);

  nowMs += 60_001;
  assert.equal(sessions.authenticateCookie(issued.setCookie.split(";", 1)[0]), null);
});

test("服务端撤销后旧 Cookie 立即失效", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-session-revoke-"));
  const repository = openRentalDatabase(path.join(tempDir, "rental.sqlite"));
  const sessions = createSessionService({ repository, now: () => new Date("2026-08-30T00:00:00.000Z") });
  t.after(async () => {
    repository.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const issued = sessions.createAnonymousSession();
  const cookie = issued.setCookie.split(";", 1)[0];
  assert.ok(sessions.authenticateCookie(cookie));

  sessions.revokeSession(issued.sessionId);
  assert.equal(sessions.authenticateCookie(cookie), null);
});
