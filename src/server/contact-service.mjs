import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClock } from "../clock.mjs";

const CONTACT_TYPES = new Set(["phone", "wechat", "email"]);
const ENVELOPE_VERSION = 1;
const ALGORITHM = "aes-256-gcm";

function contactError(message = "联系方式格式无效") {
  return Object.assign(new Error(message), { status: 422, code: "CONTACT_INVALID" });
}

function maskPhone(value) {
  if (value.startsWith("+86") && value.length === 14) return `+86${value.slice(3, 6)}****${value.slice(-4)}`;
  const prefixLength = Math.min(3, Math.max(1, value.length - 4));
  return `${value.slice(0, prefixLength)}****${value.slice(-4)}`;
}

function maskEmail(value) {
  const [local, domain] = value.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskWechat(value) {
  if (value.length <= 4) return `${value.slice(0, 1)}***${value.slice(-1)}`;
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export function normalizeContact(typeInput, valueInput) {
  const type = String(typeInput || "").trim().toLowerCase();
  if (!CONTACT_TYPES.has(type)) throw contactError("联系方式类型无效");
  let value = String(valueInput || "").normalize("NFKC").trim();
  if (!value) throw contactError();

  if (type === "phone") {
    value = value.replace(/[\s()-]/gu, "");
    if (!/^\+?[0-9]{7,15}$/u.test(value)) throw contactError("手机号格式无效");
    return { type, value, maskedValue: maskPhone(value) };
  }
  if (type === "email") {
    value = value.toLowerCase();
    if (value.length > 254 || !/^[^\s@]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/u.test(value)) throw contactError("邮箱格式无效");
    return { type, value, maskedValue: maskEmail(value) };
  }

  value = value.toLowerCase();
  if (value.length < 2 || value.length > 64 || !/^[\p{L}\p{N}._-]+$/u.test(value)) throw contactError("微信号格式无效");
  return { type, value, maskedValue: maskWechat(value) };
}

export function parseContactEncryptionKey(input) {
  const encoded = String(input || "").trim();
  if (!encoded) throw new Error("真实市场启动需要 CONTACT_ENCRYPTION_KEY");
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) {
    throw new Error("CONTACT_ENCRYPTION_KEY 必须是标准 base64");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("CONTACT_ENCRYPTION_KEY 解码后必须恰好为 32 字节");
  return key;
}

function aad(ownerId, type) {
  return Buffer.from(`contact:v${ENVELOPE_VERSION}:${ownerId}:${type}`, "utf8");
}

function encryptValue(key, ownerId, type, value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(aad(ownerId, type));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return JSON.stringify({
    version: ENVELOPE_VERSION,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  });
}

function decryptValue(key, ownerId, type, serialized) {
  const envelope = JSON.parse(serialized);
  if (envelope?.version !== ENVELOPE_VERSION) throw new Error("unsupported contact envelope");
  const nonce = Buffer.from(String(envelope.nonce || ""), "base64");
  const ciphertext = Buffer.from(String(envelope.ciphertext || ""), "base64");
  const authTag = Buffer.from(String(envelope.authTag || ""), "base64");
  if (nonce.length !== 12 || authTag.length !== 16 || !ciphertext.length) throw new Error("invalid contact envelope");
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAAD(aad(ownerId, type));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Stores only AES-GCM envelopes and exposes plaintext solely to the grant boundary. */
export function createContactService({
  database,
  encryptionKey,
  clock = createClock(),
  onSecurityError = () => {}
}) {
  if (!database?.raw) throw new Error("contact service requires an open rental database");
  const key = parseContactEncryptionKey(encryptionKey);
  const db = database.raw;
  const statements = {
    upsert: db.prepare(`
      INSERT INTO profile_contacts(owner_id, contact_type, encrypted_value, masked_value, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET
        contact_type = excluded.contact_type,
        encrypted_value = excluded.encrypted_value,
        masked_value = excluded.masked_value,
        updated_at = excluded.updated_at
    `),
    byOwner: db.prepare("SELECT owner_id, contact_type, encrypted_value, masked_value, updated_at FROM profile_contacts WHERE owner_id = ?")
  };

  function masked(row) {
    return row ? { type: row.contact_type, maskedValue: row.masked_value, updatedAt: row.updated_at } : null;
  }

  return {
    set(ownerId, input) {
      const normalized = normalizeContact(input?.type, input?.value);
      const at = clock.nowIso();
      statements.upsert.run(
        ownerId,
        normalized.type,
        encryptValue(key, ownerId, normalized.type, normalized.value),
        normalized.maskedValue,
        at
      );
      return masked(statements.byOwner.get(ownerId));
    },
    has(ownerId) {
      return Boolean(statements.byOwner.get(ownerId));
    },
    getMasked(ownerId) {
      return masked(statements.byOwner.get(ownerId));
    },
    reveal(ownerId) {
      const row = statements.byOwner.get(ownerId);
      if (!row) return null;
      try {
        return {
          type: row.contact_type,
          value: decryptValue(key, ownerId, row.contact_type, row.encrypted_value)
        };
      } catch {
        const event = { code: "CONTACT_DECRYPTION_FAILED", ownerId };
        try {
          onSecurityError(event);
        } catch {
          // Reporting must never replace the stable security failure.
        }
        throw Object.assign(new Error("联系方式暂时无法读取"), { status: 500, code: event.code });
      }
    }
  };
}
