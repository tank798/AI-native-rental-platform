const FORBIDDEN_TEXT = /(?:底价|最高预算|hardMax|minimumAuthorizedRent|rawText|session|token)/iu;

function schemaError(message) {
  throw Object.assign(new Error(message), { code: "CLARIFICATION_SCHEMA_INVALID" });
}

export function answerSpecForUnknown(unknown) {
  const key = String(unknown.fieldKey || "");
  if (/^listing\.facilities\.(?:kitchen|washer|ensuite|elevator)$/u.test(key)) {
    return { expectedAnswerType: "boolean", options: [true, false] };
  }
  if (key === "listing.fees.utilities") {
    return { expectedAnswerType: "enum", options: ["included", "actual_bill", "fixed_extra", "unknown"] };
  }
  if (/^(?:budget\.hardMax|listing\.rent|listing\.leaseMonthsMin|leaseMonths|commute\.routeMinutes)$/u.test(key)) {
    return { expectedAnswerType: "number", minimum: 1, maximum: key.includes("Rent") || key.includes("budget") || key.includes("rent") ? 100_000 : 120 };
  }
  if (/^(?:listing\.availableFrom|moveInWindow)$/u.test(key)) {
    return { expectedAnswerType: key === "moveInWindow" ? "date_range" : "date", options: [] };
  }
  if (key === "listing.roommateGender") {
    return { expectedAnswerType: "enum", options: ["female", "male", "none"] };
  }
  return { expectedAnswerType: "short_text", maximumLength: 120, options: [] };
}

export function parseClarificationModelOutput(payload, expected) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) schemaError("模型澄清输出必须是对象");
  const allowedKeys = new Set(["question", "fieldKey", "expectedAnswerType", "options", "reasonCode"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) schemaError("模型澄清输出包含未授权字段");
  if (payload.fieldKey !== expected.fieldKey || payload.reasonCode !== expected.reasonCode) schemaError("模型不得修改 fieldKey 或 reasonCode");
  if (payload.expectedAnswerType !== expected.expectedAnswerType) schemaError("模型不得修改答案类型");
  if (typeof payload.question !== "string" || !payload.question.trim() || payload.question.length > 160 || FORBIDDEN_TEXT.test(payload.question)) {
    schemaError("问题文本不符合公开边界");
  }
  const options = Array.isArray(payload.options) ? payload.options : [];
  if (JSON.stringify(options) !== JSON.stringify(expected.options || [])) schemaError("模型不得修改允许选项");
  return {
    question: payload.question.trim(),
    fieldKey: expected.fieldKey,
    expectedAnswerType: expected.expectedAnswerType,
    options: [...(expected.options || [])],
    reasonCode: expected.reasonCode
  };
}

export function parseClarificationAnswer(rawAnswer, spec) {
  const type = spec.expectedAnswerType;
  if (type === "boolean") {
    if (rawAnswer === true || rawAnswer === false) return rawAnswer;
    if (rawAnswer === "true") return true;
    if (rawAnswer === "false") return false;
    schemaError("请选择是或否");
  }
  if (type === "enum") {
    if (!spec.options.includes(rawAnswer)) schemaError("答案不在允许选项中");
    return rawAnswer;
  }
  if (type === "number") {
    const number = Number(rawAnswer);
    if (!Number.isFinite(number) || number < spec.minimum || number > spec.maximum) schemaError("数值超出允许范围");
    return number;
  }
  if (type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(rawAnswer || ""))) schemaError("日期必须是 YYYY-MM-DD");
    return String(rawAnswer);
  }
  if (type === "date_range") {
    if (!rawAnswer || typeof rawAnswer !== "object" || !/^\d{4}-\d{2}-\d{2}$/u.test(rawAnswer.from) || !/^\d{4}-\d{2}-\d{2}$/u.test(rawAnswer.to) || rawAnswer.from > rawAnswer.to) {
      schemaError("日期范围不合法");
    }
    return { from: rawAnswer.from, to: rawAnswer.to };
  }
  const text = String(rawAnswer || "").trim();
  if (!text || text.length > Number(spec.maximumLength || 120) || FORBIDDEN_TEXT.test(text)) schemaError("答案文本不合法");
  return text;
}

export const clarificationForbiddenText = FORBIDDEN_TEXT;
