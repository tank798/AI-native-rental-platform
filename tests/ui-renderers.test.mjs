import test from "node:test";
import assert from "node:assert/strict";

import { renderMatchDetail } from "../src/ui/match-detail.mjs";
import { renderTaskCenter } from "../src/ui/task-center.mjs";

test("任务中心把恶意任务标题作为文本编码", () => {
  const html = renderTaskCenter({
    tasks: [{
      id: "11111111-1111-4111-8111-111111111111",
      kind: "renter",
      status: "active",
      label: '<img src=x onerror="globalThis.pwned=1">',
      candidateCount: 1,
      clarificationCount: 0,
      myConfirmationCount: 0,
      otherConfirmationCount: 0
    }]
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /onerror=&quot;globalThis\.pwned=1&quot;/);
});

test("匹配详情编码公开标题与事实字段", () => {
  const html = renderMatchDetail({
    title: "次卧</h1><script>alert(1)</script>",
    subtitle: '<svg onload="alert(2)">',
    facts: ["18㎡<iframe src=x>"]
  });
  assert.doesNotMatch(html, /<script|<svg|<iframe/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;svg/);
  assert.match(html, /&lt;iframe/);
});
