import { randomBytes } from "node:crypto";

/** Creates a fresh test-only AES-256 key without committing secret material. */
export function testContactEncryptionKey() {
  return randomBytes(32).toString("base64");
}
