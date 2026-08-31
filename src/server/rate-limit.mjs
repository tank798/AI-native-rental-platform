import { createClock } from "../clock.mjs";

function bucketId(scope, key) {
  return `${scope}\u0000${key}`;
}

/**
 * Creates an in-memory fixed-window limiter with atomic multi-dimension
 * consumption. The interface is intentionally storage-agnostic so production
 * can replace the Map with a shared limiter without changing route policy.
 */
export function createRateLimiter({ now = createClock().nowMs } = {}) {
  const buckets = new Map();

  function currentBucket(rule, at) {
    const id = bucketId(rule.scope, rule.key);
    const existing = buckets.get(id);
    if (!existing || existing.resetAt <= at) {
      return { id, scope: rule.scope, key: rule.key, count: 0, resetAt: at + rule.windowMs };
    }
    return { id, ...existing };
  }

  return {
    consume(rules) {
      const at = Number(now());
      const states = rules.map((rule) => ({ rule, state: currentBucket(rule, at) }));
      const denied = states.find(({ rule, state }) => state.count >= rule.limit);
      if (denied) {
        return {
          allowed: false,
          scope: denied.rule.scope,
          retryAfterSeconds: Math.max(1, Math.ceil((denied.state.resetAt - at) / 1000))
        };
      }
      for (const { state } of states) {
        buckets.set(state.id, { ...state, count: state.count + 1 });
      }
      return { allowed: true };
    },

    inspect(scope, key) {
      const at = Number(now());
      const state = buckets.get(bucketId(scope, key));
      if (!state || state.resetAt <= at) return { count: 0, resetAt: null };
      return { count: state.count, resetAt: state.resetAt };
    },

    clear() {
      buckets.clear();
    }
  };
}
