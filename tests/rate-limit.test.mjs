import assert from "node:assert/strict";
import test from "node:test";

import { createRateLimiter } from "../src/server/rate-limit.mjs";

test("多维配额原子消费，任一维超限时不扣减其他维度", () => {
  let nowMs = 1_000;
  const limiter = createRateLimiter({ now: () => nowMs });
  const dimensions = [
    { scope: "ai-ip", key: "127.0.0.1", limit: 2, windowMs: 60_000 },
    { scope: "ai-profile-day", key: "profile-1", limit: 1, windowMs: 86_400_000 }
  ];

  assert.equal(limiter.consume(dimensions).allowed, true);
  const denied = limiter.consume(dimensions);
  assert.equal(denied.allowed, false);
  assert.equal(denied.scope, "ai-profile-day");
  assert.ok(denied.retryAfterSeconds > 0);

  // The denied attempt must not consume the still-available IP token.
  assert.equal(limiter.inspect("ai-ip", "127.0.0.1").count, 1);

  nowMs += 86_400_001;
  assert.equal(limiter.consume(dimensions).allowed, true);
});

test("不同 scope 和 key 互不串扰", () => {
  const limiter = createRateLimiter({ now: () => 10_000 });
  const rule = (key) => [{ scope: "session-create", key, limit: 1, windowMs: 60_000 }];

  assert.equal(limiter.consume(rule("ip-a")).allowed, true);
  assert.equal(limiter.consume(rule("ip-a")).allowed, false);
  assert.equal(limiter.consume(rule("ip-b")).allowed, true);
});

