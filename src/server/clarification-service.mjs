import { clarificationPrompt } from "../ai/clarification-prompt.mjs";
import {
  answerSpecForUnknown,
  parseClarificationAnswer,
  parseClarificationModelOutput
} from "../ai/clarification-schema.mjs";
import { createClock } from "../clock.mjs";

function serviceError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function priorityFor(unknown) {
  const reason = String(unknown.reasonCode || "");
  const key = String(unknown.fieldKey || "");
  if (/(?:ROLE|RIGHTS|VERIFICATION|SAFETY|IDENTITY)/u.test(reason)) return 100;
  if (/(?:LOCATION|CITY|COMMUTE|MOVE_IN|REQUIRED_FACILITY|HOUSING)/u.test(reason)) return 90;
  if (/(?:BUDGET|RENT|LEASE|FEE|TOTAL_COST)/u.test(reason)) return 80;
  if (/(?:ROOMMATE|VIEWING|SCHEDULE)/u.test(reason)) return 70;
  if (/(?:preference|exposure|floor)/iu.test(`${reason}:${key}`)) return 50;
  return 60;
}

function templateQuestion(unknown) {
  const key = String(unknown.fieldKey || "");
  const facility = key.match(/^listing\.facilities\.(.+)$/u)?.[1];
  const facilityLabel = {
    kitchen: "独立厨房",
    washer: "洗衣机",
    ensuite: "独立卫生间",
    elevator: "电梯"
  }[facility];
  if (facilityLabel) return `这套房源是否具备${facilityLabel}？`;
  const templates = {
    "listing.fees.utilities": "水电燃气费是包含在月租中，还是按账单另付？",
    "budget.hardMax": "你能接受的月租上限是多少？",
    "listing.rent": "请确认这套房源的月租。",
    "listing.concessionRent": "有租客希望在挂牌价基础上议价。你可以接受的月租是多少？",
    leaseMonths: "你计划租住几个月？",
    "listing.leaseMonthsMin": "这套房源最短需要租几个月？",
    moveInWindow: "你可以在哪个日期范围内入住？",
    "listing.availableFrom": "这套房源最早哪天可入住？",
    "listing.roommateGender": "请确认当前室友性别。",
    "commute.routeMinutes": "从房源到通勤目的地预计需要多少分钟？",
    targetLocations: "你想住在哪些区域？",
    "listing.location": "请确认房源所在商圈或地铁站。",
    city: "请确认找房城市。",
    "listing.city": "请确认房源所在城市。"
  };
  return templates[key] || unknown.label || "请补充这项匹配信息。";
}

function setNested(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = value;
}

function nextPayloadForAnswer(task, targetParty, fieldKey, value) {
  const payload = structuredClone(task.payload);
  if (targetParty === "supply") {
    const draft = payload.draft || (payload.draft = {});
    if (fieldKey === "listing.rent") {
      // A direct rent reply also authorizes that amount as the matching floor
      // when the owner has not provided a separate private minimum.
      draft.listedRent = value;
      if (draft.minimumAuthorizedRent === null || draft.minimumAuthorizedRent === undefined) {
        draft.minimumAuthorizedRent = value;
      }
    }
    else if (fieldKey === "commute.routeMinutes") draft.commuteMinutes = value;
    else if (fieldKey.startsWith("listing.")) setNested(draft, fieldKey.slice("listing.".length), value);
    else setNested(draft, fieldKey, value);
  } else {
    const mandate = payload.mandate || (payload.mandate = {});
    if (fieldKey === "targetLocations") mandate.locations = String(value).split(/[\s、,\/]+/u).filter(Boolean);
    else setNested(mandate, fieldKey, value);
  }
  return payload;
}

function isConfirmed(taskRepository, task, unknown) {
  const persisted = taskRepository.getField(task.id, unknown.fieldKey);
  if (persisted?.source === "user_confirmed" || persisted?.confirmationStatus === "confirmed" && persisted?.source === "user_confirmed") return true;
  const states = task.payload?.fieldStates || {};
  const aliases = [unknown.fieldKey, unknown.fieldKey.split(".").at(-1)];
  return aliases.some((key) => states[key]?.confirmationStatus === "user_confirmed");
}

export function selectClarificationQuestions({ blockingUnknowns, existingClarifications = [], taskByParty, taskRepository, limit = 3 }) {
  const answered = new Set(existingClarifications
    .filter((item) => item.status === "answered")
    .map((item) => `${item.targetParty}\u0000${item.fieldKey}`));
  const open = new Set(existingClarifications
    .filter((item) => item.status === "open")
    .map((item) => `${item.targetParty}\u0000${item.fieldKey}`));
  return [...blockingUnknowns]
    .filter((unknown) => !answered.has(`${unknown.targetParty}\u0000${unknown.fieldKey}`))
    .filter((unknown) => {
      const task = taskByParty?.[unknown.targetParty];
      return !task || !taskRepository || !isConfirmed(taskRepository, task, unknown);
    })
    .map((unknown) => {
      const answerSpec = answerSpecForUnknown(unknown);
      return {
        targetParty: unknown.targetParty,
        fieldKey: unknown.fieldKey,
        reasonCode: unknown.reasonCode,
        priority: priorityFor(unknown),
        question: templateQuestion(unknown),
        answerSpec,
        provider: open.has(`${unknown.targetParty}\u0000${unknown.fieldKey}`) ? "existing" : "rule_template"
      };
    })
    .sort((left, right) => right.priority - left.priority || left.fieldKey.localeCompare(right.fieldKey, "zh-CN"))
    .slice(0, Math.max(1, Math.min(3, Number(limit) || 3)));
}

/** Selects, persists and answers targeted questions without exposing counterpart secrets. */
export function createClarificationService({
  taskRepository,
  matchCaseRepository,
  clock = createClock(),
  questionGenerator = null,
  recalculate = null
}) {
  let recalculateTask = recalculate;

  function selected(matchCase, evaluation, tasks) {
    return selectClarificationQuestions({
      blockingUnknowns: evaluation.blockingUnknowns,
      existingClarifications: matchCaseRepository.listClarifications(matchCase.id),
      taskByParty: tasks,
      taskRepository
    });
  }

  function syncForCase({ matchCase, evaluation, renterTask, supplyTask }) {
    const questions = evaluation.status === "clarifying"
      ? selected(matchCase, evaluation, { renter: renterTask, supply: supplyTask })
      : [];
    return matchCaseRepository.syncClarifications(matchCase.id, questions, evaluation.evaluatedAt);
  }

  async function syncForCaseWithModel(context) {
    const base = context.evaluation.status === "clarifying"
      ? selected(context.matchCase, context.evaluation, { renter: context.renterTask, supply: context.supplyTask })
      : [];
    const questions = [];
    for (const item of base) {
      if (!questionGenerator) {
        questions.push({ ...item, provider: "rule_fallback" });
        continue;
      }
      try {
        const prompt = clarificationPrompt({
          fieldKey: item.fieldKey,
          reasonCode: item.reasonCode,
          expectedAnswerType: item.answerSpec.expectedAnswerType,
          options: item.answerSpec.options || [],
          templateQuestion: item.question,
          publicContext: { matchStatus: context.matchCase.status }
        });
        const output = await questionGenerator(prompt);
        const parsed = parseClarificationModelOutput(output, {
          fieldKey: item.fieldKey,
          reasonCode: item.reasonCode,
          expectedAnswerType: item.answerSpec.expectedAnswerType,
          options: item.answerSpec.options || []
        });
        questions.push({ ...item, question: parsed.question, provider: "qwen" });
      } catch {
        questions.push({ ...item, provider: "rule_fallback" });
      }
    }
    return matchCaseRepository.syncClarifications(context.matchCase.id, questions, context.evaluation.evaluatedAt);
  }

  async function answer({ matchCaseId, clarificationId, ownerId, rawAnswer }) {
    const request = matchCaseRepository.getClarificationForOwner(clarificationId, matchCaseId, ownerId);
    if (!request) throw serviceError(404, "CLARIFICATION_NOT_FOUND", "澄清问题不存在");
    let structuredAnswer;
    try {
      structuredAnswer = parseClarificationAnswer(rawAnswer, request.answerSpec);
    } catch (error) {
      error.status = 422;
      throw error;
    }
    if (request.status !== "open") {
      if (request.status === "answered" && JSON.stringify(request.structuredAnswer) === JSON.stringify(structuredAnswer)) {
        return { clarification: request, idempotent: true, task: null };
      }
      throw serviceError(409, "CLARIFICATION_ANSWER_CONFLICT", "该问题已经用不同答案关闭");
    }
    const matchCase = matchCaseRepository.get(matchCaseId);
    const targetTaskId = request.targetParty === "renter" ? matchCase.renterTaskId : matchCase.supplyTaskId;
    const task = taskRepository.get(targetTaskId);
    if (isConfirmed(taskRepository, task, request)) throw serviceError(409, "FIELD_ALREADY_CONFIRMED", "该字段已由用户确认");
    const nextPayload = nextPayloadForAnswer(task, request.targetParty, request.fieldKey, structuredAnswer);
    const at = clock.nowIso();
    const result = matchCaseRepository.transaction(() => {
      const updated = taskRepository.applyFieldAnswer({
        taskId: targetTaskId,
        fieldKey: request.fieldKey,
        value: structuredAnswer,
        nextPayload,
        at
      });
      const clarification = matchCaseRepository.markClarificationAnswered(
        clarificationId,
        matchCaseId,
        typeof rawAnswer === "string" ? rawAnswer : JSON.stringify(rawAnswer),
        structuredAnswer,
        at
      );
      return { clarification, task: updated.task, field: updated.field, idempotent: false };
    });
    if (recalculateTask) await recalculateTask(targetTaskId);
    return result;
  }

  return {
    selectQuestions: selected,
    syncForCase,
    syncForCaseWithModel,
    answer,
    setRecalculate(callback) {
      recalculateTask = callback;
    }
  };
}
