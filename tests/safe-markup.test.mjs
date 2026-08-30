import assert from "node:assert/strict";
import test from "node:test";

import { escapeAttribute, escapeText } from "../src/ui/safe-markup.mjs";

test("不可信文本会在 HTML sink 前完整编码", () => {
  assert.equal(
    escapeText(`<img src=x onerror="globalThis.__xss=1">'&`),
    "&lt;img src=x onerror=&quot;globalThis.__xss=1&quot;&gt;&#039;&amp;"
  );
});

test("属性编码覆盖单双引号、尖括号和空值", () => {
  assert.equal(escapeAttribute(`静安寺" autofocus onfocus='x' <`), "静安寺&quot; autofocus onfocus=&#039;x&#039; &lt;");
  assert.equal(escapeAttribute(null), "");
  assert.equal(escapeText(undefined), "");
});

test("编码始终发生在输出层且不会把原值当作可信 HTML", () => {
  const storedValue = `<svg onload=alert(1)>&already`;

  assert.equal(storedValue, `<svg onload=alert(1)>&already`);
  assert.equal(escapeText(storedValue), "&lt;svg onload=alert(1)&gt;&amp;already");
});

