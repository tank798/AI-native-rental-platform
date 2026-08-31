import { httpError } from "./request-guards.mjs";

const FORBIDDEN_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function invalidField(field, message) {
  throw httpError(422, "INVALID_FIELD", message, { field });
}

function boundedText(value, { field, maxLength, required = false }) {
  if (value === null || value === undefined) {
    if (required) invalidField(field, `${field} 不能为空`);
    return null;
  }
  if (typeof value !== "string") invalidField(field, `${field} 必须是文本`);
  const normalized = value.trim();
  if (required && !normalized) invalidField(field, `${field} 不能为空`);
  if (normalized.length > maxLength) invalidField(field, `${field} 最多 ${maxLength} 个字符`);
  if (FORBIDDEN_CONTROL_CHARACTERS.test(normalized)) invalidField(field, `${field} 包含无效控制字符`);
  return normalized;
}

function validateTaskValue(value, field, depth = 0) {
  if (depth > 8) invalidField(field, `${field} 嵌套过深`);
  if (value === null || value === undefined || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidField(field, `${field} 必须是有限数值`);
    return;
  }
  if (typeof value === "string") {
    const maxLength = field.endsWith(".rawText") ? 4_000 : 1_000;
    if (value.length > maxLength) invalidField(field, `${field} 最多 ${maxLength} 个字符`);
    if (FORBIDDEN_CONTROL_CHARACTERS.test(value)) invalidField(field, `${field} 包含无效控制字符`);
    return;
  }
  if (Array.isArray(value)) {
    const maxItems = field === "payload.mandate.locations" ? 10 : 20;
    if (value.length > maxItems) invalidField(field, `${field} 最多 ${maxItems} 项`);
    value.forEach((item, index) => validateTaskValue(item, `${field}.${index}`, depth + 1));
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 80) invalidField(field, `${field} 字段过多`);
    entries.forEach(([key, item]) => validateTaskValue(item, `${field}.${key}`, depth + 1));
    return;
  }
  invalidField(field, `${field} 包含不支持的值`);
}

function modelSchemaError(field) {
  throw Object.assign(new Error("模型输出不符合字段契约"), {
    code: "MODEL_SCHEMA_INVALID",
    field
  });
}

function modelText(value, field, maxLength = 240) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > maxLength || FORBIDDEN_CONTROL_CHARACTERS.test(value)) {
    modelSchemaError(field);
  }
  return value.trim();
}

function modelNumber(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) modelSchemaError(field);
  return value;
}

function modelBoolean(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") modelSchemaError(field);
  return value;
}

function modelStringArray(value, field, { maxItems = 12, maxLength = 240 } = {}) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) modelSchemaError(field);
  return value.map((item, index) => modelText(item, `${field}.${index}`, maxLength));
}

function modelObject(value, field) {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) modelSchemaError(field);
  return value;
}

export function parseIntakeRequest(body) {
  const text = boundedText(body?.text, { field: "text", maxLength: 4_000, required: true });
  const referenceDate = boundedText(body?.referenceDate, { field: "referenceDate", maxLength: 10, required: true });
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(referenceDate)) invalidField("referenceDate", "referenceDate 必须是 YYYY-MM-DD");
  return { text, referenceDate };
}

export function parseTaskCreateRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalidField("body", "任务请求必须是对象");
  if (!new Set(["renter", "supply"]).has(body.kind)) invalidField("kind", "kind 只能是 renter 或 supply");
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) invalidField("payload", "payload 必须是对象");
  const payload = structuredClone(body.payload);
  validateTaskValue(payload, "payload");
  payload.rawText = boundedText(payload.rawText ?? "", { field: "payload.rawText", maxLength: 4_000 }) || "";
  const inputVersion = Number(payload.inputVersion ?? 1);
  if (!Number.isInteger(inputVersion) || inputVersion < 1 || inputVersion > 1_000_000) {
    invalidField("payload.inputVersion", "payload.inputVersion 必须是正整数");
  }
  if (payload.fieldStates !== undefined && (!payload.fieldStates || typeof payload.fieldStates !== "object" || Array.isArray(payload.fieldStates))) {
    invalidField("payload.fieldStates", "payload.fieldStates 必须是对象");
  }
  payload.inputVersion = inputVersion;
  payload.fieldStates = payload.fieldStates || {};
  const clientRequestId = boundedText(body.clientRequestId, { field: "clientRequestId", maxLength: 120 });
  if (clientRequestId && !/^[A-Za-z0-9:_-]{8,120}$/u.test(clientRequestId)) {
    invalidField("clientRequestId", "clientRequestId 格式无效");
  }
  return { kind: body.kind, payload, clientRequestId };
}

/** Returns the allowlisted first renter record from a model JSON response. */
export function parseRenterModelPayload(payload) {
  if (!payload || !Array.isArray(payload.renters) || payload.renters.length !== 1) modelSchemaError("renters");
  const source = modelObject(payload.renters[0], "renters.0");
  const budget = modelObject(source.budget, "renters.0.budget");
  const moveIn = modelObject(source.move_in, "renters.0.move_in");
  const housing = modelObject(source.housing, "renters.0.housing");
  const hard = modelObject(source.hard, "renters.0.hard");
  return {
    city: modelText(source.city, "renters.0.city", 80),
    locations: modelStringArray(source.locations, "renters.0.locations", { maxItems: 10, maxLength: 120 }),
    commute_destinations: modelStringArray(source.commute_destinations, "renters.0.commute_destinations", { maxItems: 5, maxLength: 120 }),
    publisher_role: modelText(source.publisher_role, "renters.0.publisher_role", 24),
    budget: {
      target: modelNumber(budget.target, "renters.0.budget.target"),
      max: modelNumber(budget.max, "renters.0.budget.max")
    },
    move_in: {
      from: modelText(moveIn.from, "renters.0.move_in.from", 10),
      to: modelText(moveIn.to, "renters.0.move_in.to", 10)
    },
    max_commute_minutes: modelNumber(source.max_commute_minutes, "renters.0.max_commute_minutes"),
    housing: {
      shared: modelBoolean(housing.shared, "renters.0.housing.shared"),
      roommate_gender: modelText(housing.roommate_gender, "renters.0.housing.roommate_gender", 16)
    },
    hard: {
      elevator: modelBoolean(hard.elevator, "renters.0.hard.elevator"),
      ensuite: modelBoolean(hard.ensuite, "renters.0.hard.ensuite"),
      kitchen: modelBoolean(hard.kitchen, "renters.0.hard.kitchen"),
      washer: modelBoolean(hard.washer, "renters.0.hard.washer"),
      residential_utilities: modelBoolean(hard.residential_utilities, "renters.0.hard.residential_utilities")
    },
    clarifying_questions: modelStringArray(source.clarifying_questions, "renters.0.clarifying_questions", { maxItems: 6, maxLength: 240 })
  };
}

/** Returns the allowlisted first supply record from a model JSON response. */
export function parseSupplyModelPayload(payload) {
  if (!payload || !Array.isArray(payload.listings) || payload.listings.length !== 1) modelSchemaError("listings");
  const source = modelObject(payload.listings[0], "listings.0");
  const housing = modelObject(source.housing, "listings.0.housing");
  const facilities = modelObject(source.facilities, "listings.0.facilities");
  const fees = modelObject(source.fees, "listings.0.fees");
  return {
    city: modelText(source.city, "listings.0.city", 80),
    location: modelText(source.location, "listings.0.location", 120),
    station: modelText(source.station, "listings.0.station", 120),
    role: modelText(source.role, "listings.0.role", 24),
    claimed_role: modelText(source.claimed_role, "listings.0.claimed_role", 80),
    listed_rent: modelNumber(source.listed_rent, "listings.0.listed_rent"),
    private_min_rent: modelNumber(source.private_min_rent, "listings.0.private_min_rent"),
    available_from: modelText(source.available_from, "listings.0.available_from", 10),
    housing: {
      shared: modelBoolean(housing.shared, "listings.0.housing.shared"),
      roommate_gender: modelText(housing.roommate_gender, "listings.0.housing.roommate_gender", 16)
    },
    facilities: {
      elevator: modelBoolean(facilities.elevator, "listings.0.facilities.elevator"),
      ensuite: modelBoolean(facilities.ensuite, "listings.0.facilities.ensuite"),
      kitchen: modelBoolean(facilities.kitchen, "listings.0.facilities.kitchen"),
      washer: modelBoolean(facilities.washer, "listings.0.facilities.washer"),
      residential_utilities: modelBoolean(facilities.residential_utilities, "listings.0.facilities.residential_utilities")
    },
    fees: {
      service: modelNumber(fees.service, "listings.0.fees.service"),
      intermediary: modelNumber(fees.intermediary, "listings.0.fees.intermediary")
    },
    risk_signals: modelStringArray(source.risk_signals, "listings.0.risk_signals", { maxItems: 20, maxLength: 80 }),
    public_summary: modelText(source.public_summary, "listings.0.public_summary", 500)
  };
}
