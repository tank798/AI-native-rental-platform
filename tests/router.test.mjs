import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMatchRoute,
  buildRoute,
  buildTaskRoute,
  parseRoute,
  pushRoute,
  replaceRoute
} from "../src/ui/router.mjs";

const taskId = "11111111-1111-4111-8111-111111111111";
const matchCaseId = "22222222-2222-4222-8222-222222222222";

test("路由解析主页、任务中心、任务与匹配详情", () => {
  assert.deepEqual(parseRoute("/"), { name: "home" });
  assert.deepEqual(parseRoute("/?view=tasks"), { name: "task-center" });
  assert.deepEqual(parseRoute(`/?task=${taskId}`), { name: "task", taskId });
  assert.deepEqual(parseRoute(`/?task=${taskId}&match=${matchCaseId}`), {
    name: "match",
    taskId,
    matchCaseId
  });
});

test("路由拒绝未知视图、孤立 match 和可疑标识符", () => {
  assert.equal(parseRoute("/?view=admin").name, "invalid");
  assert.equal(parseRoute(`/?match=${matchCaseId}`).reason, "match_without_task");
  assert.equal(parseRoute("/?task=%3Cscript%3Ealert(1)%3C%2Fscript%3E").reason, "invalid_task_id");
  assert.equal(parseRoute(`/?task=${taskId}&match=../../secret`).reason, "invalid_match_id");
});

test("路由构造仅保留应用自己的确定状态", () => {
  assert.equal(buildRoute({ name: "home" }, "https://example.test/?token=secret"), "/");
  assert.equal(buildRoute({ name: "task-center" }, "https://example.test/?token=secret"), "/?view=tasks");
  assert.equal(buildRoute({ name: "task", taskId }, "https://example.test/"), `/?task=${taskId}`);
  assert.equal(buildTaskRoute(taskId, "https://example.test/"), `/?task=${taskId}`);
  assert.equal(
    buildRoute({ name: "match", taskId, matchCaseId }, "https://example.test/"),
    `/?task=${taskId}&match=${matchCaseId}`
  );
  assert.equal(
    buildMatchRoute(taskId, matchCaseId, "https://example.test/"),
    `/?task=${taskId}&match=${matchCaseId}`
  );
  assert.throws(() => buildRoute({ name: "task", taskId: "not-an-id" }), /无效/);
});

test("push 与 replace 写入历史但不读取页面 DOM", () => {
  const calls = [];
  const navigation = {
    location: { href: "https://example.test/?old=1" },
    history: {
      pushState: (...args) => calls.push(["push", ...args]),
      replaceState: (...args) => calls.push(["replace", ...args])
    }
  };
  assert.equal(pushRoute({ name: "task", taskId }, navigation), `/?task=${taskId}`);
  assert.equal(replaceRoute({ name: "task-center" }, navigation), "/?view=tasks");
  assert.deepEqual(calls, [
    ["push", { route: "task" }, "", `/?task=${taskId}`],
    ["replace", { route: "task-center" }, "", "/?view=tasks"]
  ]);
});
