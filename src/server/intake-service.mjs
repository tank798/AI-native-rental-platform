import { parseDemandText } from "../demand-parser.mjs";
import { parseSupplyText } from "../supply-parser.mjs";
import { renterRuntimePrompt, supplyRuntimePrompt } from "../ai/prompts.mjs";
import { readApiKey, SiliconFlowClient, siliconFlowDefaults } from "../ai/siliconflow-client.mjs";
import { parseRenterModelPayload, parseSupplyModelPayload } from "./schemas.mjs";

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableBoolean(value) {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function fillIfMissing(current, incoming) {
  return hasValue(current) ? current : incoming;
}

function fillBooleanIfMissing(current, incoming) {
  return current === null || current === undefined ? incoming : current;
}

function mergeRenter(ruleResult, aiResult) {
  if (!aiResult) return ruleResult;
  const fields = structuredClone(ruleResult.fields);
  fields.locations = Array.isArray(fields.locations) ? fields.locations : [];
  fields.preferences = fields.preferences || {};
  fields.facilities = fields.facilities || {};
  if (!hasValue(fields.city) && hasValue(aiResult.city)) fields.city = aiResult.city;
  if (!fields.locations.length && Array.isArray(aiResult.locations) && aiResult.locations.length) fields.locations = aiResult.locations;

  const currentBudget = fields.budget || { target: null, hardMax: null, explicitRange: false, capInferred: false };
  const target = fillIfMissing(currentBudget.target, finiteNumber(aiResult.budget?.target));
  const hardMax = fillIfMissing(currentBudget.hardMax, finiteNumber(aiResult.budget?.max));
  if (hasValue(target) || hasValue(hardMax)) {
    fields.budget = {
      ...currentBudget,
      target,
      hardMax,
      explicitRange: Boolean(currentBudget.explicitRange || (!hasValue(currentBudget.hardMax) && hasValue(aiResult.budget?.max))),
      capInferred: hasValue(hardMax) ? false : Boolean(currentBudget.capInferred)
    };
  }

  if (!fields.moveInWindow && (aiResult.move_in?.from || aiResult.move_in?.to)) {
    const from = aiResult.move_in.from || aiResult.move_in.to;
    const to = aiResult.move_in.to || aiResult.move_in.from;
    fields.moveInWindow = { from, to, label: "AI 从原话确认" };
  }
  if (!hasValue(fields.maxCommuteMinutes) && hasValue(aiResult.max_commute_minutes)) {
    fields.maxCommuteMinutes = finiteNumber(aiResult.max_commute_minutes);
  }
  const shared = nullableBoolean(aiResult.housing?.shared);
  fields.sharedHousing = fillBooleanIfMissing(fields.sharedHousing, shared);
  if (!hasValue(fields.roommateGender) && hasValue(aiResult.housing?.roommate_gender)) fields.roommateGender = aiResult.housing.roommate_gender;

  const kitchen = nullableBoolean(aiResult.hard?.kitchen);
  const washer = nullableBoolean(aiResult.hard?.washer);
  fields.facilities.kitchen = fillBooleanIfMissing(fields.facilities.kitchen, kitchen);
  fields.facilities.washer = fillBooleanIfMissing(fields.facilities.washer, washer);
  const elevator = nullableBoolean(aiResult.hard?.elevator);
  const ensuite = nullableBoolean(aiResult.hard?.ensuite);
  const utilities = nullableBoolean(aiResult.hard?.residential_utilities);
  if (!hasValue(fields.preferences.elevator) && elevator !== null) fields.preferences.elevator = elevator ? "required" : "any";
  if (!hasValue(fields.preferences.ensuite) && ensuite !== null) fields.preferences.ensuite = ensuite ? "required" : "any";
  if (!hasValue(fields.preferences.utilities) && utilities !== null) fields.preferences.utilities = utilities ? "residential" : "any";

  const coreMissing = [];
  if (!fields.locations?.length) coreMissing.push("location");
  if (!fields.budget?.hardMax) coreMissing.push("budget");
  if (!fields.moveInWindow?.from || !fields.moveInWindow?.to) coreMissing.push("moveIn");
  if (fields.sharedHousing === null) coreMissing.push("housing");
  if (!fields.maxCommuteMinutes) coreMissing.push("commute");

  return {
    ...ruleResult,
    fields,
    coreMissing,
    aiQuestions: Array.isArray(aiResult.clarifying_questions) ? aiResult.clarifying_questions : []
  };
}

function mergeSupply(ruleResult, aiResult) {
  if (!aiResult) return ruleResult;
  const fields = structuredClone(ruleResult.fields);
  fields.room = fields.room || {};
  fields.facilities = fields.facilities || {};
  fields.fees = fields.fees || {};
  if (!hasValue(fields.city) && hasValue(aiResult.city)) fields.city = aiResult.city;
  if (!hasValue(fields.location) && hasValue(aiResult.location)) fields.location = aiResult.location;
  if (!hasValue(fields.station) && hasValue(aiResult.station)) fields.station = aiResult.station;
  if (!hasValue(fields.role) && hasValue(aiResult.role) && aiResult.role !== "unknown") fields.role = aiResult.role;
  if (!hasValue(fields.claimedRole) && hasValue(aiResult.claimed_role)) fields.claimedRole = aiResult.claimed_role;
  if (!hasValue(fields.listedRent) && hasValue(aiResult.listed_rent)) fields.listedRent = finiteNumber(aiResult.listed_rent);
  if (!hasValue(fields.minRent) && hasValue(aiResult.private_min_rent)) fields.minRent = finiteNumber(aiResult.private_min_rent);
  if (!hasValue(fields.availableFrom) && hasValue(aiResult.available_from)) fields.availableFrom = aiResult.available_from;
  const shared = nullableBoolean(aiResult.housing?.shared);
  if (fields.room.roommateCount === null || fields.room.roommateCount === undefined) {
    if (shared !== null) fields.room.roommateCount = shared ? 1 : 0;
  }
  if (!hasValue(fields.room.roommateGender) && hasValue(aiResult.housing?.roommate_gender)) fields.room.roommateGender = aiResult.housing.roommate_gender;
  const facilityMap = {
    elevator: "elevator",
    ensuite: "ensuite",
    kitchen: "kitchen",
    washer: "washer"
  };
  Object.entries(facilityMap).forEach(([aiKey, localKey]) => {
    const value = nullableBoolean(aiResult.facilities?.[aiKey]);
    if ((fields.facilities[localKey] === null || fields.facilities[localKey] === undefined) && value !== null) fields.facilities[localKey] = value;
  });
  const residentialUtilities = nullableBoolean(aiResult.facilities?.residential_utilities);
  if (!hasValue(fields.facilities.utilities) && residentialUtilities !== null) {
    fields.facilities.utilities = residentialUtilities ? "residential" : "unknown";
  }
  if (!hasValue(fields.fees.service) && hasValue(aiResult.fees?.service)) fields.fees.service = finiteNumber(aiResult.fees.service);
  if (!hasValue(fields.fees.intermediary) && hasValue(aiResult.fees?.intermediary)) fields.fees.intermediary = finiteNumber(aiResult.fees.intermediary);

  const deterministicRisk = new Set(ruleResult.riskSignals || []);
  const criticalRiskSignals = new Set(["broker_role", "role_conflict", "prohibited_fee"]);
  (aiResult.risk_signals || [])
    .filter((item) => !criticalRiskSignals.has(item))
    .forEach((item) => deterministicRisk.add(item));
  if (fields.role === "broker") {
    deterministicRisk.add("broker_role");
    deterministicRisk.add("role_conflict");
  }
  if (Number(fields.fees.service || 0) > 0 || Number(fields.fees.intermediary || 0) > 0) deterministicRisk.add("prohibited_fee");

  const missingFields = [];
  if (!fields.role) missingFields.push("role");
  if (!fields.location) missingFields.push("location");
  if (!fields.listedRent) missingFields.push("listedRent");
  if (!fields.availableFrom) missingFields.push("availableFrom");
  if (fields.room.roommateCount === null) missingFields.push("roommates");

  return {
    ...ruleResult,
    fields,
    riskSignals: [...deterministicRisk],
    missingFields,
    publicSummary: typeof aiResult.public_summary === "string" ? aiResult.public_summary : null
  };
}

export function createIntakeService({
  apiKey = null,
  keyFile = null,
  model = siliconFlowDefaults.model,
  clientOptions = {}
} = {}) {
  let clientPromise = null;

  async function client() {
    if (!apiKey && !keyFile) return null;
    if (!clientPromise) {
      clientPromise = (async () => {
        const resolvedKey = apiKey || await readApiKey(keyFile);
        return new SiliconFlowClient({ apiKey: resolvedKey, model, ...clientOptions });
      })();
    }
    return clientPromise;
  }

  async function withAi({ stage, prompt, select, ruleResult, merge }) {
    const aiClient = await client();
    if (!aiClient) return { parsed: ruleResult, provider: "deterministic", warning: null, warningCode: null };
    try {
      const payload = await aiClient.json({ stage, system: prompt.system, user: prompt.user, maxTokens: 2200 });
      return { parsed: merge(ruleResult, select(payload)), provider: "siliconflow", warning: null, warningCode: null };
    } catch {
      return {
        parsed: ruleResult,
        provider: "deterministic",
        warning: "AI 暂时不可用，已使用确定性解析",
        warningCode: "AI_DEGRADED"
      };
    }
  }

  return {
    status() {
      return { configured: Boolean(apiKey || keyFile), model: apiKey || keyFile ? model : null };
    },

    parseRenterDeterministic(text, referenceDate) {
      return {
        parsed: parseDemandText(text, referenceDate),
        provider: "deterministic",
        warning: "AI 预算已达当日上限，已使用确定性解析",
        warningCode: "AI_DEGRADED"
      };
    },

    parseSupplyDeterministic(text, referenceDate) {
      return {
        parsed: parseSupplyText(text, referenceDate),
        provider: "deterministic",
        warning: "AI 预算已达当日上限，已使用确定性解析",
        warningCode: "AI_DEGRADED"
      };
    },

    async parseRenter(text, referenceDate) {
      const ruleResult = parseDemandText(text, referenceDate);
      return withAi({
        stage: "runtime_renter_intake",
        prompt: renterRuntimePrompt(text, referenceDate),
        select: parseRenterModelPayload,
        ruleResult,
        merge: mergeRenter
      });
    },

    async parseSupply(text, referenceDate) {
      const ruleResult = parseSupplyText(text, referenceDate);
      return withAi({
        stage: "runtime_supply_intake",
        prompt: supplyRuntimePrompt(text, referenceDate),
        select: parseSupplyModelPayload,
        ruleResult,
        merge: mergeSupply
      });
    }
  };
}
