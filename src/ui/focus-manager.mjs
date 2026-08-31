const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function focusableElements(modal) {
  return [...(modal?.querySelectorAll?.(FOCUSABLE_SELECTOR) || [])]
    .filter((element) => !element.hidden && element.getAttribute?.("aria-hidden") !== "true");
}

function elementFocusKey(element) {
  if (!element) return null;
  if (element.dataset?.focusKey) return element.dataset.focusKey;
  if (element.id) return `id:${element.id}`;
  const action = element.dataset?.action;
  const input = element.dataset?.input;
  const value = element.dataset?.value || "";
  const key = element.dataset?.key || "";
  if (action) return `action:${action}:${key}:${value}`;
  if (input) return `input:${input}`;
  if (element.name) return `name:${element.name}`;
  return null;
}

export function createFocusManager({ documentRef = globalThis.document } = {}) {
  let triggerKey = null;
  let inertElements = [];

  function setBackgroundInert(elements, inert) {
    for (const element of elements.filter(Boolean)) {
      element.inert = inert;
      if (inert) element.setAttribute?.("aria-hidden", "true");
      else element.removeAttribute?.("aria-hidden");
    }
  }

  function restoreFocus(focusKey, root = documentRef) {
    if (!focusKey || !root?.querySelectorAll) return false;
    const candidates = [root, ...root.querySelectorAll("[data-focus-key], [id], [data-action], [data-input], [name]")];
    const target = candidates.find((element) => elementFocusKey(element) === focusKey);
    if (!target?.focus) return false;
    target.focus({ preventScroll: true });
    return true;
  }

  function openModal({ modal, trigger, initialFocus, background = [] }) {
    if (!modal) return null;
    triggerKey = elementFocusKey(trigger) || triggerKey;
    inertElements = background.filter(Boolean);
    setBackgroundInert(inertElements, true);
    modal.setAttribute?.("role", "dialog");
    modal.setAttribute?.("aria-modal", "true");
    if (!modal.hasAttribute?.("tabindex")) modal.setAttribute?.("tabindex", "-1");
    const target = typeof initialFocus === "string"
      ? modal.querySelector?.(initialFocus)
      : initialFocus || focusableElements(modal)[0] || modal;
    target?.focus?.({ preventScroll: true });
    return triggerKey;
  }

  function closeModal({ modal, restore = true } = {}) {
    if (modal) {
      modal.removeAttribute?.("aria-modal");
      modal.removeAttribute?.("role");
    }
    setBackgroundInert(inertElements, false);
    inertElements = [];
    const key = triggerKey;
    triggerKey = null;
    if (restore) restoreFocus(key);
    return key;
  }

  function trapTab(event, modal) {
    if (event?.key !== "Tab" || !modal) return false;
    const focusable = focusableElements(modal);
    if (!focusable.length) {
      event.preventDefault?.();
      modal.focus?.();
      return true;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = documentRef?.activeElement;
    if (event.shiftKey && (active === first || !modal.contains?.(active))) {
      event.preventDefault?.();
      last.focus?.();
      return true;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault?.();
      first.focus?.();
      return true;
    }
    return false;
  }

  return {
    closeModal,
    elementFocusKey,
    focusableElements,
    openModal,
    restoreFocus,
    trapTab
  };
}

const defaultManager = createFocusManager();

export const openModal = (options) => defaultManager.openModal(options);
export const closeModal = (options) => defaultManager.closeModal(options);
export const restoreFocus = (focusKey, root) => defaultManager.restoreFocus(focusKey, root);
export const trapTab = (event, modal) => defaultManager.trapTab(event, modal);

