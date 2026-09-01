import assert from "node:assert/strict";
import test from "node:test";

import { createClock } from "../src/clock.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createNotificationService } from "../src/server/notification-service.mjs";

test("站内通知持久化、去重并由服务端维护未读数", (t) => {
  const clock = createClock({ now: () => new Date("2026-08-31T00:00:00.000Z") });
  const database = openRentalDatabase(":memory:", { clock });
  t.after(() => database.close());
  database.createProfile({ id: "owner-1", tokenHash: "notify-owner-1" });
  const notifications = createNotificationService({ database, clock });
  const input = {
    ownerId: "owner-1",
    type: "new_candidate",
    aggregateId: "case-1",
    payload: { title: "新候选", message: "查看公开条件", matchCaseId: "case-1" },
    dedupeKey: "candidate:owner-1:case-1"
  };
  assert.equal(notifications.notify(input).inserted, true);
  assert.equal(notifications.notify(input).inserted, false);
  const first = notifications.list("owner-1");
  assert.equal(first.notifications.length, 1);
  assert.equal(first.unreadCount, 1);
  notifications.markRead(first.notifications[0].id, "owner-1");
  assert.equal(notifications.unreadCount("owner-1"), 0);
});

test("到期前 48 小时通知只生成一次且不复制任务私密 payload", (t) => {
  const clock = createClock({ now: () => new Date("2026-08-31T00:00:00.000Z") });
  const database = openRentalDatabase(":memory:", { clock });
  t.after(() => database.close());
  database.createProfile({ id: "owner-1", tokenHash: "notify-expiring" });
  database.createTask({
    id: "task-1",
    ownerId: "owner-1",
    kind: "renter",
    label: "静安寺找房",
    payload: { rawText: "不应进入通知", mandate: { budget: { hardMax: 4000 } } },
    expiresAt: "2026-09-01T12:00:00.000Z"
  });
  const notifications = createNotificationService({ database, clock });
  notifications.syncOwner("owner-1");
  notifications.syncOwner("owner-1");
  const result = notifications.list("owner-1");
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].type, "task_expiring");
  assert.doesNotMatch(JSON.stringify(result), /不应进入通知|hardMax|4000/u);
});

