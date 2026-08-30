import assert from "node:assert/strict";
import test from "node:test";

import {
  parseIntakeRequest,
  parseRenterModelPayload,
  parseSupplyModelPayload,
  parseTaskCreateRequest
} from "../src/server/schemas.mjs";

test("intake 文本有长度、控制字符和日期契约", () => {
  assert.deepEqual(
    parseIntakeRequest({ text: " 静安寺附近找房\n预算 3500 ", referenceDate: "2026-08-30" }),
    { text: "静安寺附近找房\n预算 3500", referenceDate: "2026-08-30" }
  );
  assert.throws(
    () => parseIntakeRequest({ text: "x".repeat(4_001), referenceDate: "2026-08-30" }),
    (error) => error.code === "INVALID_FIELD" && error.details?.field === "text"
  );
  assert.throws(
    () => parseIntakeRequest({ text: "静安寺\u0000找房", referenceDate: "2026-08-30" }),
    (error) => error.code === "INVALID_FIELD"
  );
  assert.throws(
    () => parseIntakeRequest({ text: "静安寺找房", referenceDate: "30/08/2026" }),
    (error) => error.code === "INVALID_FIELD" && error.details?.field === "referenceDate"
  );
});

test("任务创建只接受受限 kind、对象 payload 和短原文", () => {
  const parsed = parseTaskCreateRequest({ kind: "renter", payload: { rawText: "找房", mandate: {} } });
  assert.equal(parsed.kind, "renter");
  assert.equal(parsed.payload.rawText, "找房");
  assert.throws(
    () => parseTaskCreateRequest({ kind: "broker", payload: {} }),
    (error) => error.code === "INVALID_FIELD"
  );
  assert.throws(
    () => parseTaskCreateRequest({ kind: "renter", payload: { rawText: "x".repeat(4_001) } }),
    (error) => error.code === "INVALID_FIELD"
  );
});

test("任务字段限制数组数量、嵌套深度和单字段长度", () => {
  assert.throws(
    () => parseTaskCreateRequest({ kind: "renter", payload: { mandate: { locations: Array(11).fill("静安寺") } } }),
    (error) => error.code === "INVALID_FIELD" && error.details.field === "payload.mandate.locations"
  );
  assert.throws(
    () => parseTaskCreateRequest({ kind: "supply", payload: { draft: { title: "房".repeat(1_001) } } }),
    (error) => error.code === "INVALID_FIELD" && error.details.field === "payload.draft.title"
  );
  assert.throws(
    () => parseTaskCreateRequest({ kind: "supply", payload: { draft: { tags: Array(21).fill("tag") } } }),
    (error) => error.code === "INVALID_FIELD" && error.details.field === "payload.draft.tags"
  );
});

test("模型结果按 allowlist 归一，额外字段不会进入运行时", () => {
  const renter = parseRenterModelPayload({
    renters: [{
      city: "上海",
      locations: ["静安寺"],
      budget: { target: 3200, max: 3500 },
      max_commute_minutes: 35,
      clarifying_questions: ["最高预算是多少？"],
      injected_private_field: "should disappear"
    }]
  });
  assert.equal(renter.injected_private_field, undefined);
  assert.deepEqual(renter.locations, ["静安寺"]);

  const supply = parseSupplyModelPayload({
    listings: [{
      location: "静安寺",
      role: "landlord",
      listed_rent: 3500,
      risk_signals: ["unusual_claim"],
      owner_token: "should disappear"
    }]
  });
  assert.equal(supply.owner_token, undefined);
  assert.equal(supply.listed_rent, 3500);
});

test("模型结果形状或字段类型错误时稳定降级", () => {
  assert.throws(
    () => parseRenterModelPayload({ renters: [{ locations: "静安寺" }] }),
    (error) => error.code === "MODEL_SCHEMA_INVALID"
  );
  assert.throws(
    () => parseSupplyModelPayload({ listings: [{ listed_rent: "三千五" }] }),
    (error) => error.code === "MODEL_SCHEMA_INVALID"
  );
});
