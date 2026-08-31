import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createClock } from "../src/clock.mjs";
import {
  createContactService,
  normalizeContact,
  parseContactEncryptionKey
} from "../src/server/contact-service.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { testContactEncryptionKey } from "./test-secrets.mjs";

async function fixture(t, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-contact-"));
  const clock = createClock({ now: () => new Date("2026-08-31T00:00:00.000Z") });
  const database = openRentalDatabase(path.join(tempDir, "rental.sqlite"), { clock });
  const securityEvents = [];
  const contacts = createContactService({
    database,
    encryptionKey: options.encryptionKey || testContactEncryptionKey(),
    clock,
    onSecurityError: (event) => securityEvents.push(event)
  });
  database.createProfile({ id: "owner-a", tokenHash: "contact-owner-a" });
  database.createProfile({ id: "owner-b", tokenHash: "contact-owner-b" });
  t.after(async () => {
    database.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  return { database, contacts, securityEvents };
}

test("联系人按类型规范化、限制长度并只返回掩码", () => {
  assert.deepEqual(normalizeContact("phone", " +86 138-0013-8000 "), {
    type: "phone",
    value: "+8613800138000",
    maskedValue: "+86138****8000"
  });
  assert.deepEqual(normalizeContact("email", " Alice.Example@Example.COM "), {
    type: "email",
    value: "alice.example@example.com",
    maskedValue: "a***@example.com"
  });
  assert.deepEqual(normalizeContact("wechat", "  Home_Renter-2026  "), {
    type: "wechat",
    value: "home_renter-2026",
    maskedValue: "ho***26"
  });
  assert.throws(() => normalizeContact("phone", "123"), (error) => error.code === "CONTACT_INVALID");
  assert.throws(() => normalizeContact("email", "not-an-email"), (error) => error.code === "CONTACT_INVALID");
  assert.throws(() => normalizeContact("wechat", "x".repeat(65)), (error) => error.code === "CONTACT_INVALID");
});

test("AES-256-GCM 同一明文每次保存产生不同密文且数据库不出现原值", async (t) => {
  const { database, contacts } = await fixture(t);
  const original = "+8613800138000";

  const first = contacts.set("owner-a", { type: "phone", value: original });
  const firstEnvelope = database.raw.prepare("SELECT encrypted_value FROM profile_contacts WHERE owner_id = ?").get("owner-a").encrypted_value;
  const second = contacts.set("owner-a", { type: "phone", value: original });
  const secondEnvelope = database.raw.prepare("SELECT encrypted_value FROM profile_contacts WHERE owner_id = ?").get("owner-a").encrypted_value;

  assert.equal(first.value, undefined);
  assert.equal(first.maskedValue, "+86138****8000");
  assert.deepEqual(second, first);
  assert.notEqual(firstEnvelope, secondEnvelope);
  assert.doesNotMatch(firstEnvelope, /13800138000/u);
  assert.doesNotMatch(secondEnvelope, /13800138000/u);
  assert.equal(contacts.reveal("owner-a").value, original);
  assert.deepEqual(contacts.getMasked("owner-a"), { type: "phone", maskedValue: "+86138****8000", updatedAt: "2026-08-31T00:00:00.000Z" });
});

test("错误密钥或篡改 auth tag 只暴露安全错误码，不泄露联系人原值", async (t) => {
  const { database, contacts, securityEvents } = await fixture(t);
  const original = "safe-contact@example.com";
  contacts.set("owner-a", { type: "email", value: original });

  const wrongKeyContacts = createContactService({
    database,
    encryptionKey: testContactEncryptionKey(),
    onSecurityError: (event) => securityEvents.push(event)
  });
  assert.throws(() => wrongKeyContacts.reveal("owner-a"), (error) => error.code === "CONTACT_DECRYPTION_FAILED" && !error.message.includes(original));

  const row = database.raw.prepare("SELECT encrypted_value FROM profile_contacts WHERE owner_id = ?").get("owner-a");
  const envelope = JSON.parse(row.encrypted_value);
  envelope.authTag = Buffer.alloc(16, 0xff).toString("base64");
  database.raw.prepare("UPDATE profile_contacts SET encrypted_value = ? WHERE owner_id = ?").run(JSON.stringify(envelope), "owner-a");
  assert.throws(() => contacts.reveal("owner-a"), (error) => error.code === "CONTACT_DECRYPTION_FAILED");
  assert.doesNotMatch(JSON.stringify(securityEvents), new RegExp(original, "u"));
  assert.ok(securityEvents.every((event) => event.code === "CONTACT_DECRYPTION_FAILED" && event.ownerId === "owner-a"));
});

test("联系人密钥必须是恰好 32 字节的 base64", () => {
  assert.equal(parseContactEncryptionKey(testContactEncryptionKey()).length, 32);
  assert.throws(() => parseContactEncryptionKey(""), /CONTACT_ENCRYPTION_KEY/u);
  assert.throws(() => parseContactEncryptionKey("plain-text-key"), /CONTACT_ENCRYPTION_KEY/u);
  assert.throws(() => parseContactEncryptionKey(Buffer.alloc(16).toString("base64")), /32 字节/u);
});
