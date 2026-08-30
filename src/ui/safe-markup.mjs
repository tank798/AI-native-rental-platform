/**
 * Encodes an untrusted value for a text node inside an HTML template.
 * Business values stay raw in storage and JSON; encoding only happens at the
 * final browser rendering boundary so APIs do not become double-encoded.
 */
export function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Encodes an untrusted value placed inside a quoted HTML attribute. */
export const escapeAttribute = escapeText;

