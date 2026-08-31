import assert from "node:assert/strict";
import test from "node:test";

import { createFocusManager } from "../src/ui/focus-manager.mjs";

function element({ id = "", dataset = {}, focusable = [], contains = () => true } = {}) {
  const attributes = new Map();
  return {
    id,
    dataset,
    hidden: false,
    inert: false,
    focusable,
    contains,
    focusCalls: 0,
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    hasAttribute(name) { return attributes.has(name); },
    removeAttribute(name) { attributes.delete(name); },
    querySelectorAll() { return this.focusable; },
    querySelector() { return this.focusable[0] || null; },
    focus() { this.focusCalls += 1; }
  };
}

test("opening and closing a modal manages semantics, inert background and trigger focus", () => {
  const trigger = element({ dataset: { action: "open-create" } });
  const first = element({ dataset: { action: "create-renter" } });
  const modal = element({ focusable: [first] });
  const main = element();
  const root = element({ focusable: [trigger] });
  const manager = createFocusManager({ documentRef: root });

  manager.openModal({ modal, trigger, background: [main] });
  assert.equal(modal.getAttribute("role"), "dialog");
  assert.equal(modal.getAttribute("aria-modal"), "true");
  assert.equal(main.inert, true);
  assert.equal(first.focusCalls, 1);

  manager.closeModal({ modal });
  assert.equal(main.inert, false);
  assert.equal(trigger.focusCalls, 1);
});

test("Tab and Shift+Tab wrap inside the active dialog", () => {
  const first = element({ dataset: { action: "first" } });
  const last = element({ dataset: { action: "last" } });
  const modal = element({ focusable: [first, last] });
  const documentRef = { activeElement: last, querySelectorAll: () => [] };
  const manager = createFocusManager({ documentRef });
  let prevented = 0;

  assert.equal(manager.trapTab({ key: "Tab", shiftKey: false, preventDefault: () => prevented += 1 }, modal), true);
  assert.equal(first.focusCalls, 1);
  documentRef.activeElement = first;
  assert.equal(manager.trapTab({ key: "Tab", shiftKey: true, preventDefault: () => prevented += 1 }, modal), true);
  assert.equal(last.focusCalls, 1);
  assert.equal(prevented, 2);
});

test("stable focus keys restore controls after a render", () => {
  const replacement = element({ dataset: { focusKey: "input:budget-max" } });
  const root = { querySelectorAll: () => [replacement] };
  const manager = createFocusManager({ documentRef: root });
  assert.equal(manager.restoreFocus("input:budget-max"), true);
  assert.equal(replacement.focusCalls, 1);
});

