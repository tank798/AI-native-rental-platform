import assert from "node:assert/strict";
import test from "node:test";

import {
  addDaysToIso,
  compareIsoDates,
  createClock,
  isoTimestampAfterDays
} from "../src/clock.mjs";

test("上海时区自然日在 UTC 16:00 边界正确翻日", () => {
  const before = createClock({ now: () => new Date("2026-08-29T15:59:59.999Z") });
  const after = createClock({ now: () => new Date("2026-08-29T16:00:00.000Z") });

  assert.equal(before.todayInShanghai(), "2026-08-29");
  assert.equal(after.todayInShanghai(), "2026-08-30");
});

test("ISO 自然日与时间戳不混用比较", () => {
  assert.equal(compareIsoDates("2026-08-25", "2026-08-30"), -1);
  assert.equal(compareIsoDates("2026-08-30", "2026-08-30"), 0);
  assert.throws(() => compareIsoDates("2026-08-30T00:00:00Z", "2026-08-30"), /ISO date/);
});

test("日期与任务到期时间可通过 fake clock 确定性生成", () => {
  const clock = createClock({ now: () => new Date("2026-08-29T16:00:00.000Z") });

  assert.equal(addDaysToIso("2026-08-30", 30), "2026-09-29");
  assert.equal(isoTimestampAfterDays(clock, 30), "2026-09-28T16:00:00.000Z");
  assert.equal(clock.nowIso(), "2026-08-29T16:00:00.000Z");
});
