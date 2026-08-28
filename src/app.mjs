import { baseMandate, demoSupplyDraft, labScenarios } from "./fixtures.mjs";
import { parseDemandText, parsedDemandTags } from "./demand-parser.mjs";
import {
  evaluateReport,
  matchSupplyDraft,
  runLabScenario,
  runRegressionSuite,
  validateSupplyDraft
} from "./simulation-engine.mjs";
import { bearAgentMarkup, launchBearAgent, mountBearAgents } from "./bear-agent.mjs";
import {
  addDaysToIso,
  createTaskLifecycle,
  evaluateTaskLifecycle,
  renewTaskLifecycle
} from "./task-lifecycle.mjs";

const app = document.querySelector("#app");

const iconPaths = {
  radar: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4V2M20 12h2M12 20v2M4 12H2"/>',
  cards: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  mic: '<rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  location: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  camera: '<path d="M4 7h3l1.5-2h7L17 7h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.7 3.1 7.6 7.5 9.5 4.4-1.9 7.5-4.8 7.5-9.5V6z"/><path d="m9 12 2 2 4-5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  report: '<path d="M5 21V4m0 1h11l-2 4 2 4H5"/>',
  home: '<path d="m3 11 9-8 9 8v10h-6v-6H9v6H3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="m14 7 3 3"/>',
  spark: '<path d="m12 2 1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
  contact: '<circle cx="9" cy="8" r="4"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.1h-4v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4h-.1v-4H3A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1v-.1h4V3a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.36.34.7.6 1 .27.25.62.4 1 .4h.1v4H21a1.7 1.7 0 0 0-1.6.6Z"/>',
  archive: '<path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6"/>',
  elysHome: '<path d="M12 2.7 14.2 5l3-.5.8 2.9 2.8 1.2-1.2 2.8 1.9 2.4-2.4 1.9.4 3-2.9.8-1.2 2.8-2.8-1.2-2.4 1.9-1.9-2.4-3 .4-.8-2.9-2.8-1.2 1.2-2.8L2.7 12l2.4-1.9-.4-3 2.9-.8L8.8 3.5l2.8 1.2Z" fill="currentColor" stroke="none"/>',
  elysBubble: '<path d="M4.4 4.5h15.2A2.4 2.4 0 0 1 22 6.9v8.6a2.4 2.4 0 0 1-2.4 2.4h-8.2l-4.8 3v-3H4.4A2.4 2.4 0 0 1 2 15.5V6.9a2.4 2.4 0 0 1 2.4-2.4Z" fill="currentColor" stroke="none"/>',
  elysDiamond: '<path d="m12 2.4 9.6 9.6-9.6 9.6L2.4 12Z" fill="currentColor" stroke="none"/>',
  elysUser: '<circle cx="12" cy="7.2" r="4.2" fill="currentColor" stroke="none"/><path d="M4 21a8 8 0 0 1 16 0Z" fill="currentColor" stroke="none"/>'
};

function icon(name, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.spark}</svg>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatShortDate(isoDate) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" })
    .format(new Date(`${isoDate}T12:00:00+08:00`));
}

function defaultAnswers() {
  return {
    location: "",
    budgetMin: "",
    budgetMax: "",
    moveInFrom: "",
    moveInTo: "",
    commute: "35",
    roommate: "any",
    bathroom: "any",
    elevator: "any",
    utilities: "any",
    kitchen: "any",
    washer: "any"
  };
}

const startingSupplyDraft = {
  ...structuredClone(demoSupplyDraft),
  availableFrom: "2026-08-29"
};

const demoRenewalTask = {
  id: "renewal-demo",
  kind: "supply",
  label: "静安寺次卧",
  lifecycle: createTaskLifecycle(addDaysToIso(todayInShanghai(), -25))
};

let state = {
  tab: "match",
  flow: null,
  page: "root",
  sheet: null,
  renterStage: "input",
  supplyStage: "draft",
  draftText: "",
  parsedDemand: null,
  listening: false,
  answers: defaultAnswers(),
  selectedLocations: [],
  locationSearch: "",
  locationRadius: "2",
  locateState: "idle",
  consent: false,
  supplyDraft: startingSupplyDraft,
  supplyPledge: false,
  supplyValidation: null,
  photoPreviews: [{ src: "./assets/room-sunlit.jpg", label: "卧室" }],
  task: null,
  result: null,
  supplyResult: null,
  activeCandidateId: null,
  reportType: "broker_or_fee",
  reportHasEvidence: false,
  reportResult: null,
  taskNotices: [demoRenewalTask],
  archivedTasks: [],
  messagesRead: false,
  contactUnlocked: false,
  activeScenario: "full-demo",
  regression: null,
  toast: null,
  motion: "full"
};

let voiceRecognition = null;
let toastTimer = null;
let lastViewKey = null;
let matchTimers = [];

function showToast(message) {
  state.toast = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, 2200);
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
  showToast(successMessage);
}

function syncExpiredTask() {
  if (!state.task?.lifecycle) return;
  const lifecycleState = evaluateTaskLifecycle(state.task.lifecycle, todayInShanghai());
  if (!lifecycleState.expired) return;
  state.archivedTasks.push({ ...state.task, archivedReason: "expired" });
  state.task = null;
  state.result = null;
  state.supplyResult = null;
  state.activeCandidateId = null;
}

function seedAnswersFromParsed(parsed) {
  const fields = parsed?.fields;
  if (!fields) return;
  if (fields.locations.length) {
    state.selectedLocations = [...fields.locations];
    state.answers.location = fields.locations.join(" / ");
  }
  if (fields.budget?.target) state.answers.budgetMin = String(fields.budget.target);
  if (fields.budget?.hardMax) state.answers.budgetMax = String(fields.budget.hardMax);
  if (fields.moveInWindow?.from) state.answers.moveInFrom = fields.moveInWindow.from;
  if (fields.moveInWindow?.to) state.answers.moveInTo = fields.moveInWindow.to;
  if (fields.maxCommuteMinutes) state.answers.commute = String(fields.maxCommuteMinutes);
  if (fields.sharedHousing === false) state.answers.roommate = "no_share";
  if (fields.sharedHousing === true) state.answers.roommate = fields.roommateGender || "any";
  if (fields.preferences.ensuite) state.answers.bathroom = fields.preferences.ensuite;
  if (fields.preferences.elevator) state.answers.elevator = fields.preferences.elevator;
  if (fields.preferences.utilities) state.answers.utilities = fields.preferences.utilities;
  if (fields.facilities.kitchen !== null) state.answers.kitchen = fields.facilities.kitchen ? "required" : "any";
  if (fields.facilities.washer !== null) state.answers.washer = fields.facilities.washer ? "required" : "any";
}

function mandateFromAnswers() {
  const mandate = structuredClone(baseMandate);
  const parsed = state.parsedDemand?.fields;
  const targetBudget = parsed?.budget?.target || Number(state.answers.budgetMin);
  const hardMax = parsed?.budget?.hardMax || Number(state.answers.budgetMax);
  mandate.city = parsed?.city || "上海";
  mandate.locations = state.selectedLocations.length
    ? [...state.selectedLocations]
    : parsed?.locations?.length
      ? [...parsed.locations]
      : state.answers.location.split(/(?:、|\/|，|,)/).map((item) => item.trim()).filter(Boolean);
  mandate.maxCommuteMinutes = parsed?.maxCommuteMinutes || Number(state.answers.commute);
  mandate.budget.target = targetBudget;
  mandate.budget.hardMax = hardMax;
  mandate.moveInWindow = structuredClone(parsed?.moveInWindow || {
    from: state.answers.moveInFrom,
    to: state.answers.moveInTo
  });
  mandate.roommateGender = parsed?.roommateGender || (["female", "male"].includes(state.answers.roommate) ? state.answers.roommate : null);
  mandate.sharedHousing = parsed?.sharedHousing ?? state.answers.roommate !== "no_share";
  mandate.hardConstraints.ensuite = state.answers.bathroom === "required";
  mandate.hardConstraints.elevator = state.answers.elevator === "required";
  mandate.hardConstraints.kitchen = parsed?.facilities?.kitchen ?? state.answers.kitchen === "required";
  mandate.hardConstraints.washer = parsed?.facilities?.washer ?? state.answers.washer === "required";
  mandate.preferences.ensuite = state.answers.bathroom;
  mandate.preferences.elevator = state.answers.elevator;
  mandate.preferences.utilities = state.answers.utilities;
  return mandate;
}

function validateDemandAnswers() {
  const mandate = mandateFromAnswers();
  if (!mandate.locations.length) return "请在地图上选择区域";
  if (!mandate.budget.target || !mandate.budget.hardMax) return "请填写月租范围";
  if (mandate.budget.target < 500 || mandate.budget.hardMax < mandate.budget.target) return "月租范围需要从低到高";
  if (!mandate.moveInWindow?.from || !mandate.moveInWindow?.to) return "请填写入住日期范围";
  if (mandate.moveInWindow.to < mandate.moveInWindow.from) return "最晚入住日期不能早于最早日期";
  if (mandate.maxCommuteMinutes < 15 || mandate.maxCommuteMinutes > 60) return "通勤时间需在 15 到 60 分钟之间";
  return null;
}

function statusBar() {
  return `<div class="status-bar" aria-hidden="true"><span>9:41</span><span class="status-icons"><i></i><i></i><i></i><b>5G</b><span class="battery"></span></span></div>`;
}

function rootHeader() {
  return "";
}

function flowHeader(title) {
  return `<header class="flow-header"><button data-action="cancel-flow" aria-label="取消">${icon("close")}</button><strong>${title}</strong><span></span></header>`;
}

function tabBar() {
  const tabs = [
    ["match", "elysHome", "首页"],
    ["results", "elysDiamond", "候选"],
    ["messages", "elysBubble", "消息"],
    ["profile", "elysUser", "我的"]
  ];
  return `<nav class="tab-dock" aria-label="主要导航">
    <div class="tab-items">
      ${tabs.slice(0, 2).map(([value, iconName, label]) => tabButton(value, iconName, label)).join("")}
      <span class="tab-gap" aria-hidden="true"></span>
      ${tabs.slice(2).map(([value, iconName, label]) => tabButton(value, iconName, label)).join("")}
    </div>
    <button class="create-task-button" data-action="open-create" aria-label="新建找房或出租任务">${icon("plus")}</button>
  </nav>`;
}

function tabButton(value, iconName, label) {
  const badge = value === "messages" && !state.messagesRead ? '<i class="tab-badge">1</i>' : "";
  return `<button class="tab-item" data-action="switch-tab" data-value="${value}" aria-label="${label}" aria-current="${state.tab === value ? "page" : "false"}">${icon(iconName)}<span>${label}</span>${badge}</button>`;
}

function renterInput() {
  return `<section class="flow-screen renter-input-screen">
    ${flowHeader("发布找房需求")}
    <div class="flow-copy"><span class="flow-kicker">找房分身</span><h1>说说你想住哪儿</h1></div>
    <div class="composer-card" data-filled="${Boolean(state.draftText.trim())}">
      <textarea id="demand-input" data-input="draft-text" aria-label="输入找房需求" placeholder="位置、预算、入住时间，想到什么就说什么">${escapeHtml(state.draftText)}</textarea>
      <div class="composer-footer">
        <button class="round-control ${state.listening ? "is-listening" : ""}" data-action="voice-input" aria-label="语音输入">${icon("mic")}</button>
        <button class="composer-next" data-action="start-intake">继续 ${icon("arrow")}</button>
      </div>
    </div>
    <button class="map-entry" data-action="open-location">
      <span>${icon("map")}<b>${state.selectedLocations.length ? state.selectedLocations.join("、") : "也可以直接在地图上选"}</b></span>${icon("arrow")}
    </button>
  </section>`;
}

function answerChip(key, value, label) {
  return `<button class="choice-chip" data-action="set-answer" data-key="${key}" data-value="${value}" aria-pressed="${String(state.answers[key]) === String(value)}">${label}</button>`;
}

function coreQuestionCard(key, index) {
  const today = todayInShanghai();
  const controls = {
    location: {
      title: "想住在哪一带？",
      body: `<button class="location-picker-row" data-action="open-location"><span>${icon("map")}<b>${state.selectedLocations.length ? state.selectedLocations.join("、") : "打开地图选择"}</b></span>${icon("arrow")}</button>`
    },
    budget: {
      title: "月租控制在多少？",
      body: `<div class="paired-inputs"><label><span>理想</span><div class="money-input"><b>¥</b><input type="number" min="500" step="100" inputmode="numeric" data-input="budget-min" value="${escapeHtml(state.answers.budgetMin)}" placeholder="3000" /></div></label><i>—</i><label><span>最高</span><div class="money-input"><b>¥</b><input type="number" min="500" step="100" inputmode="numeric" data-input="budget-max" value="${escapeHtml(state.answers.budgetMax)}" placeholder="4000" /></div></label></div>`
    },
    moveIn: {
      title: "什么时候入住？",
      body: `<div class="paired-inputs date-pair"><label><span>最早</span><input type="date" min="${today}" data-input="move-in-from" value="${escapeHtml(state.answers.moveInFrom)}" /></label><i>—</i><label><span>最晚</span><input type="date" min="${escapeHtml(state.answers.moveInFrom || today)}" data-input="move-in-to" value="${escapeHtml(state.answers.moveInTo)}" /></label></div>`
    },
    housing: {
      title: "整租还是合租？",
      body: `<div class="choice-grid">${answerChip("roommate", "no_share", "整租")}${answerChip("roommate", "female", "女生合租")}${answerChip("roommate", "male", "男生合租")}${answerChip("roommate", "any", "都可以")}</div>`
    },
    commute: {
      title: "最长通勤多久？",
      body: `<div class="range-control"><output id="commute-value">${state.answers.commute} 分钟</output><input type="range" min="15" max="60" step="5" data-input="commute-range" value="${state.answers.commute}" /><div><span>15</span><span>60 分钟</span></div></div>`
    }
  };
  const control = controls[key];
  return `<article class="question-card"><span class="question-index">0${index + 1}</span><h2>${control.title}</h2>${control.body}</article>`;
}

function preferenceRow(key) {
  const rows = {
    ensuite: ["独卫", answerChip("bathroom", "required", "必须") + answerChip("bathroom", "preferred", "优先") + answerChip("bathroom", "any", "不限")],
    elevator: ["电梯", answerChip("elevator", "required", "必须") + answerChip("elevator", "preferred", "高楼要") + answerChip("elevator", "any", "不限")],
    utilities: ["水电", answerChip("utilities", "residential", "民用") + answerChip("utilities", "known", "透明") + answerChip("utilities", "any", "不限")],
    kitchen: ["厨房", answerChip("kitchen", "required", "需要") + answerChip("kitchen", "any", "不限")],
    washer: ["洗衣机", answerChip("washer", "required", "需要") + answerChip("washer", "any", "不限")]
  };
  const [label, controls] = rows[key];
  return `<div class="preference-row"><b>${label}</b><div>${controls}</div></div>`;
}

function renterClarify() {
  const parsed = state.parsedDemand || parseDemandText(state.draftText, todayInShanghai());
  const tags = parsedDemandTags(parsed);
  return `<section class="flow-screen">
    ${flowHeader("补充需求")}
    <div class="parsed-strip">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
    <div class="question-list">${parsed.coreMissing.map(coreQuestionCard).join("")}</div>
    ${parsed.preferenceMissing.length ? `<section class="preference-panel"><h2>居住偏好</h2>${parsed.preferenceMissing.map(preferenceRow).join("")}</section>` : ""}
    <div class="flow-bottom"><button class="primary-button" data-action="review-mandate">确认需求 ${icon("arrow")}</button></div>
  </section>`;
}

function renterReview() {
  const mandate = mandateFromAnswers();
  const roommate = !mandate.sharedHousing ? "整租" : mandate.roommateGender === "female" ? "女生合租" : mandate.roommateGender === "male" ? "男生合租" : "可合租";
  const budget = `¥${mandate.budget.target.toLocaleString("zh-CN")}—${mandate.budget.hardMax.toLocaleString("zh-CN")}`;
  const dates = `${mandate.moveInWindow.from?.slice(5).replace("-", ".")}—${mandate.moveInWindow.to?.slice(5).replace("-", ".")}`;
  return `<section class="flow-screen">
    ${flowHeader("确认找房任务")}
    <div class="review-title"><span class="flow-kicker">即将启动</span><h1>${mandate.locations.join("、")}</h1></div>
    <dl class="review-list">
      <div><dt>预算</dt><dd>${budget} / 月</dd></div>
      <div><dt>入住</dt><dd>${dates}</dd></div>
      <div><dt>通勤</dt><dd>${mandate.maxCommuteMinutes} 分钟内</dd></div>
      <div><dt>居住</dt><dd>${roommate}</dd></div>
    </dl>
    <section class="private-panel">
      <header>${icon("lock")}<h2>议价范围</h2></header>
      <div><span><b>¥${mandate.budget.target.toLocaleString("zh-CN")}</b>目标</span><span><b>¥${mandate.budget.hardMax.toLocaleString("zh-CN")}</b>上限</span></div>
    </section>
    <label class="consent-row"><input type="checkbox" data-action="toggle-consent" ${state.consent ? "checked" : ""}/><span>以上条件无误</span></label>
    <div class="launch-preview">${bearAgentMarkup({ id: "renter-review-bear", mode: "idle", compact: true, label: "等待出发的找房小熊" })}<span>准备出发</span></div>
    <div class="flow-bottom"><button class="primary-button" data-action="publish-mandate" data-bear-hover-for="renter-review-bear" ${state.consent ? "" : "disabled"}>交给小熊</button></div>
  </section>`;
}

function supplyDraftScreen() {
  const draft = state.supplyDraft;
  return `<section class="flow-screen">
    ${flowHeader("发布房源")}
    <div class="flow-copy"><span class="flow-kicker">出租分身</span><h1>把房源交给我</h1></div>
    <section class="form-section"><h2>你的身份</h2><div class="role-options"><button data-action="set-supply-role" data-value="landlord" aria-pressed="${draft.role === "landlord"}">房东本人</button><button data-action="set-supply-role" data-value="subletter" aria-pressed="${draft.role === "subletter"}">当前租客</button></div></section>
    <section class="form-card">
      <label><span>房源一句话</span><input data-input="supply-title" value="${escapeHtml(draft.title)}" /></label>
      <label><span>完整地址</span><textarea data-input="supply-address">${escapeHtml(draft.address)}</textarea></label>
      <div class="form-pair"><label><span>月租</span><input type="number" inputmode="numeric" data-input="supply-rent" value="${draft.listedRent}" /></label><label><span>可入住</span><input type="date" min="${todayInShanghai()}" data-input="supply-available" value="${escapeHtml(draft.availableFrom)}" /></label></div>
    </section>
    <section class="form-section photo-section"><div class="section-title"><h2>房源照片</h2><button data-action="open-photo-source">添加</button></div><div class="photo-grid">${state.photoPreviews.map((photo) => `<figure><img src="${photo.src}" alt="${escapeHtml(photo.label)}"/><figcaption>${escapeHtml(photo.label)}</figcaption></figure>`).join("")}<button class="add-photo" data-action="open-photo-source">${icon("plus")}<span>拍摄或选择</span></button></div></section>
    <section class="form-section"><h2>费用</h2><div class="fee-board"><span><b>¥${draft.listedRent}</b>租金</span><span><b>¥${draft.fees.deposit}</b>押金</span><span><b>¥0</b>服务费</span></div></section>
    <div class="flow-bottom"><button class="primary-button" data-action="scan-supply">检查并继续 ${icon("arrow")}</button></div>
  </section>`;
}

function supplyReviewScreen() {
  const validation = state.supplyValidation || validateSupplyDraft(state.supplyDraft);
  return `<section class="flow-screen">
    ${flowHeader("确认出租任务")}
    <div class="review-title"><span class="flow-kicker">即将启动</span><h1>${escapeHtml(state.supplyDraft.location)}次卧</h1></div>
    <div class="evidence-grid"><span>${icon("check")}身份资料</span><span>${icon("check")}角色材料</span><span>${icon("check")}出租权</span><span>${icon("check")}房源照片</span></div>
    <dl class="review-list"><div><dt>挂牌</dt><dd>¥${state.supplyDraft.listedRent.toLocaleString("zh-CN")} / 月</dd></div><div><dt>入住</dt><dd>${state.supplyDraft.availableFrom}</dd></div><div><dt>室友</dt><dd>${state.supplyDraft.roommateCount} 位女生</dd></div><div><dt>设施</dt><dd>厨房、洗衣机、电梯</dd></div></dl>
    <section class="private-panel"><header>${icon("lock")}<h2>议价范围</h2></header><div><span><b>¥${state.supplyDraft.listedRent.toLocaleString("zh-CN")}</b>挂牌</span><span><b>¥${state.supplyDraft.minimumAuthorizedRent.toLocaleString("zh-CN")}</b>底价</span></div></section>
    ${validation.errors.length ? `<div class="error-banner">${validation.errors.join("；")}</div>` : ""}
    <label class="consent-row"><input type="checkbox" data-action="toggle-supply-pledge" ${state.supplyPledge ? "checked" : ""}/><span>不收取任何中介费或服务费</span></label>
    <div class="launch-preview">${bearAgentMarkup({ id: "supply-review-bear", mode: "idle", compact: true, label: "等待出发的出租小熊" })}<span>准备出发</span></div>
    <div class="flow-bottom"><button class="primary-button" data-action="publish-supply" data-bear-hover-for="supply-review-bear" ${state.supplyPledge && validation.valid ? "" : "disabled"}>交给小熊</button></div>
  </section>`;
}

function renterFlow() {
  if (state.renterStage === "clarify") return renterClarify();
  if (state.renterStage === "review") return renterReview();
  return renterInput();
}

function supplyFlow() {
  return state.supplyStage === "review" ? supplyReviewScreen() : supplyDraftScreen();
}

function taskPhases(kind) {
  if (kind === "supply") {
    return [
      ["在看找房需求", "区域与入住时间"],
      ["在排除不合适", "预算、租期与合租条件"],
      ["在谈价格", "双方授权范围内"],
      ["找到合适租客", "仍会继续留意新的需求"]
    ];
  }
  return [
    ["在看房源", "位置与入住时间"],
    ["在排除不合适", "预算、通勤与合租条件"],
    ["在谈价格", "双方授权范围内"],
    ["找到合适房源", "仍会继续留意新房源"]
  ];
}

function matchingVisual(kind, isComplete = false) {
  const roomBubbles = ["room-sunlit.jpg", "room-lanehouse.jpg", "room-compact.jpg"];
  const people = ["林", "顾", "许"];
  const nodes = kind === "renter"
    ? roomBubbles.map((name, index) => `<span class="search-node node-${index + 1}" style="background-image:url('./assets/${name}')"></span>`).join("")
    : people.map((name, index) => `<span class="search-node person-node node-${index + 1}">${name}</span>`).join("");
  return `<div class="bear-search-field" data-kind="${kind}">
    <span class="search-ring ring-one"></span><span class="search-ring ring-two"></span>
    ${nodes}
    ${bearAgentMarkup({ id: "matching-bear", mode: isComplete ? "success" : "searching", label: isComplete ? "找到结果的小熊" : "正在匹配的小熊" })}
  </div>`;
}

function matchScreen() {
  if (!state.task) {
    return `<section class="agent-home">
      <div class="home-title"><h1>想住哪儿，交给小熊</h1></div>
      <div class="home-agent-card">
        ${bearAgentMarkup({ id: "home-bear", mode: "idle", label: "等待任务的小熊" })}
      </div>
      <div class="home-composer">
        <textarea data-input="draft-text" name="rental-demand" autocomplete="off" aria-label="输入找房需求" placeholder="比如：静安寺附近，预算 3500 元，9 月入住…">${escapeHtml(state.draftText)}</textarea>
        <div><button class="round-control voice-control ${state.listening ? "is-listening" : ""}" data-action="voice-input" aria-label="${state.listening ? "停止语音输入" : "语音输入"}" aria-pressed="${state.listening}" title="${state.listening ? "停止语音输入" : "语音输入"}">${icon("mic")}</button><button class="home-start" data-action="home-intake" data-bear-hover-for="home-bear">开始找房 ${icon("arrow")}</button></div>
      </div>
      <button class="home-supply-entry" data-action="create-supply">有房要出租 ${icon("arrow")}</button>
    </section>`;
  }
  const phases = taskPhases(state.task.kind);
  const [title, detail] = phases[state.task.phaseIndex] || phases.at(-1);
  const lifecycleState = evaluateTaskLifecycle(state.task.lifecycle, todayInShanghai());
  return `<section class="match-home">
    <div class="task-pill"><span>${state.task.kind === "renter" ? "找房" : "出租"}</span><b>${escapeHtml(state.task.label)}</b><em>${lifecycleState.daysRemaining} 天</em></div>
    ${matchingVisual(state.task.kind, state.task.delivered)}
    <div class="agent-status"><h1>${title}</h1><p>${detail}</p></div>
    <div class="match-metrics"><span><b>${state.task.scanned}</b>已查看</span><span><b>${state.task.suitable}</b>合适</span></div>
    <div class="activity-stack">${state.task.events.slice(-3).reverse().map((event) => `<article><span>${event.index}</span><div><b>${event.title}</b><p>${event.detail}</p></div></article>`).join("")}</div>
    ${state.task.delivered && state.task.suitable ? `<button class="result-callout" data-action="switch-tab" data-value="results"><span><b>${state.task.suitable} 个候选已就绪</b><em>查看为你整理的结果</em></span>${icon("arrow")}</button>` : ""}
  </section>`;
}

function roomVisualClass(listingId) {
  if (["home-nanyang", "home-longde"].includes(listingId)) return "room-one";
  if (["home-jiangsu", "home-unknown-utilities"].includes(listingId)) return "room-two";
  return "room-three";
}

function candidateCard(candidate, index) {
  const listing = candidate.listing;
  return `<article class="candidate-card"><button data-action="open-candidate" data-id="${listing.id}">
    <div class="candidate-photo ${roomVisualClass(listing.id)}"><span>0${index + 1}</span><b>${candidate.selectionLabel.replace("综合最合适", "首选").replace("预算最轻", "省预算").replace("居住条件最好", "住得好")}</b></div>
    <div class="candidate-copy"><div><h2>${listing.shortTitle}</h2><strong>¥${candidate.agreedRent.toLocaleString("zh-CN")}<small>/月</small></strong></div><p>${listing.station} · 步行 ${listing.walkMinutes} 分钟 · 通勤 ${listing.commuteMinutes} 分钟</p><div class="candidate-tags"><span>${listing.room.areaSqm}㎡</span><span>${listing.room.roommateCount} 位室友</span><span>${candidate.caveats[0] || "条件无冲突"}</span></div></div>
  </button></article>`;
}

function tenantCard(candidate, index) {
  return `<article class="tenant-card"><button data-action="contact-tenant"><span class="tenant-avatar">${candidate.tenant.alias.slice(0, 1)}</span><div class="tenant-main"><div><h2>${candidate.tenant.alias}</h2><b>${candidate.selectionLabel}</b></div><p>${candidate.tenant.occupation} · ${candidate.tenant.mandate.leaseMonths} 个月 · ${candidate.tenant.mandate.moveInWindow.from.slice(5)} 起</p><strong>¥${candidate.agreedRent.toLocaleString("zh-CN")} / 月</strong></div>${icon("arrow")}</button></article>`;
}

function resultsScreen() {
  if (!state.task) return `<section class="plain-empty candidate-empty"><p>这里空空如也</p><span class="empty-create-hint"><svg class="empty-hint-arrow" viewBox="0 0 28 24" aria-hidden="true"><path d="M25 2C15 3 8 9 5 20"/><path d="m2 16 3 4 5-2"/></svg>点击这里新建任务</span></section>`;
  if (!state.task.delivered) return `<section class="plain-empty"><div class="mini-loader"></div><h1>首批结果还在路上</h1><button data-action="switch-tab" data-value="match">查看匹配进度</button></section>`;
  const candidates = state.task.kind === "renter" ? state.result?.candidates || [] : state.supplyResult?.candidates || [];
  return `<section class="results-screen"><header><h1>${candidates.length} 个合适</h1><span>${state.task.kind === "renter" ? "房源" : "租客"}</span></header>${candidates.length ? candidates.map((candidate, index) => state.task.kind === "renter" ? candidateCard(candidate, index) : tenantCard(candidate, index)).join("") : `<div class="plain-empty inline"><p>这里空空如也</p></div>`}</section>`;
}

function insightsScreen() {
  const currentScanned = state.task?.scanned || 0;
  const currentSuitable = state.task?.suitable || 0;
  const totalScanned = 137 + currentScanned;
  const totalSuitable = 16 + currentSuitable;
  const rate = Math.round((totalSuitable / totalScanned) * 100);
  return `<section class="insights-screen"><div class="subpage-nav"><button data-action="back-profile" aria-label="返回我的">${icon("back")}</button></div>
    <div class="days-card"><span>加入</span><b>12 天</b><em>从第一次匹配开始</em></div>
    <div class="metric-grid"><article><span>任务</span><b>${8 + Number(Boolean(state.task))}</b></article><article><span>已查看</span><b>${totalScanned}</b></article><article><span>合适</span><b>${totalSuitable}</b></article><article><span>已确认</span><b>3</b></article></div>
    <section class="funnel-card"><div><h2>匹配漏斗</h2><b>${rate}%</b></div><div class="funnel-shape"><span class="funnel-wide"><b>${totalScanned}</b><em>已查看</em></span><span class="funnel-mid"><b>${totalSuitable}</b><em>条件合适</em></span><span class="funnel-tip"><b>3</b><em>双方确认</em></span></div></section>
    <section class="saved-time"><span>${icon("clock")}</span><div><b>约 94 次</b><p>往返问答被分身提前处理</p></div></section>
  </section>`;
}

function messagesScreen() {
  const notice = state.taskNotices[0];
  const noticeState = evaluateTaskLifecycle(notice.lifecycle, todayInShanghai());
  return `<section class="messages-screen">
    <header><h1>消息</h1><button aria-label="消息设置">${icon("settings")}</button></header>
    <article class="expiry-message ${noticeState.renewalDue ? "is-due" : "is-renewed"}">
      <div class="message-icon">${icon("clock")}</div>
      <div><span>${noticeState.renewalDue ? `任务将于 ${formatShortDate(notice.lifecycle.expiresAt)} 到期` : `已续至 ${formatShortDate(notice.lifecycle.expiresAt)}`}</span><h2>${escapeHtml(notice.label)}</h2><p>${noticeState.daysRemaining} 天后停止接收新匹配</p></div>
      ${noticeState.renewalDue ? `<button data-action="renew-task" data-id="${notice.id}">续 30 天</button>` : `<b class="renewed-mark">已续期</b>`}
    </article>
    <div class="message-list">
      <article><span class="message-avatar bear"><img src="./assets/bear-agent-anchor.png" alt="" width="48" height="48" /></span><div><b>小熊分身</b><p>静安寺附近新增 1 套合适房源</p></div><time>10:24</time></article>
      <article><span class="message-avatar">顾</span><div><b>双方确认</b><p>联系方式已解锁，可以约看房</p></div><time>昨天</time></article>
      <article><span class="message-avatar soft">${icon("shield")}</span><div><b>举报进度</b><p>房源已停止进入新的匹配</p></div><time>周一</time></article>
    </div>
  </section>`;
}

function profileScreen() {
  const isWorking = Boolean(state.task && !state.task.delivered);
  const agentLabel = state.task ? (state.task.delivered ? "本轮匹配已完成" : "持续匹配中") : "等待新任务";
  return `<section class="profile-screen">
    <header><img class="profile-avatar" src="./assets/user-avatar.png" alt="用户头像" width="84" height="84"/><div><h1>住哪儿用户</h1><p><span>个人房源</span><span>AI 分身已开启</span></p></div>${icon("arrow")}</header>
    <div class="profile-stats"><span><b>9</b>任务</span><span><b>140</b>已查看</span><span><b>19</b>合适</span></div>
    <section class="agent-panel ${isWorking ? "is-working" : state.task ? "is-complete" : "is-idle"}">
      <div class="profile-agent-bear">${bearAgentMarkup({ id: "profile-bear", mode: isWorking ? "searching" : state.task ? "success" : "idle", compact: true, label: "我的小熊分身" })}</div>
      <div class="profile-agent-state"><span class="profile-agent-dot" aria-hidden="true"></span><p>${agentLabel}</p>${isWorking ? '<span class="profile-agent-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : ""}</div>
    </section>
    <section class="profile-menu"><button data-action="switch-tab" data-value="match">${icon("home")}<span>我的任务</span>${icon("arrow")}</button><button data-action="open-insights">${icon("chart")}<span>匹配数据</span>${icon("arrow")}</button><button data-action="switch-tab" data-value="messages">${icon("bell")}<span>通知与续期</span>${icon("arrow")}</button></section>
    <section class="profile-menu secondary"><button data-action="open-lab">${icon("spark")}<span>案例测试台</span>${icon("arrow")}</button><button data-action="toggle-motion">${icon("radar")}<span>动态效果 · ${state.motion === "reduced" ? "减少" : "完整"}</span>${icon("arrow")}</button><button data-action="reset-all">${icon("archive")}<span>重置体验数据</span>${icon("arrow")}</button></section>
  </section>`;
}

function rootScreen() {
  if (state.page === "insights") return insightsScreen();
  if (state.tab === "results") return resultsScreen();
  if (state.tab === "messages") return messagesScreen();
  if (state.tab === "profile") return profileScreen();
  return matchScreen();
}

function activeCandidate() {
  return state.result?.candidates.find((candidate) => candidate.listing.id === state.activeCandidateId) || null;
}

function listingShareText(candidate) {
  const listing = candidate.listing;
  return [
    `${listing.shortTitle}｜¥${candidate.agreedRent.toLocaleString("zh-CN")}/月`,
    `${listing.station}，步行 ${listing.walkMinutes} 分钟，通勤约 ${listing.commuteMinutes} 分钟`,
    `${listing.room.areaSqm}㎡，${listing.room.floor}/${listing.room.totalFloors} 层，${listing.room.roommateCount} 位室友`,
    `入住：${listing.availableFrom}`,
    candidate.reasons.slice(0, 2).join("；"),
    `来自“住哪儿”的匹配摘要`
  ].join("\n");
}

function listingImagePath(listingId) {
  if (["home-nanyang", "home-longde"].includes(listingId)) return "./assets/room-sunlit.jpg";
  if (["home-jiangsu", "home-unknown-utilities"].includes(listingId)) return "./assets/room-lanehouse.jpg";
  return "./assets/room-compact.jpg";
}

async function shareCandidate(candidate) {
  const text = listingShareText(candidate);
  if (!navigator.share) {
    await copyText(text, "房源摘要已复制");
    return;
  }

  const shareData = { title: candidate.listing.shortTitle, text, url: location.href };
  try {
    const response = await fetch(listingImagePath(candidate.listing.id));
    const blob = await response.blob();
    const file = new File([blob], "房源照片.jpg", { type: blob.type || "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) shareData.files = [file];
  } catch {
    // Text and the current deep link remain shareable if the image cannot be read.
  }

  try {
    await navigator.share(shareData);
    state.sheet = null;
    showToast("已打开系统分享");
  } catch (error) {
    if (error?.name !== "AbortError") await copyText(text, "房源摘要已复制");
  }
}

function candidateDetail() {
  const candidate = activeCandidate();
  if (!candidate) return resultsScreen();
  const listing = candidate.listing;
  return `<section class="detail-screen">
    <div class="detail-topbar"><button data-action="back-root" aria-label="返回候选">${icon("back")}</button><b>${candidate.selectionLabel}</b><button data-action="open-share" aria-label="分享房源">${icon("share")}</button></div>
    <div class="detail-photo ${roomVisualClass(listing.id)}"></div>
    <div class="detail-sheet">
      <div class="detail-title"><div><h1>${listing.shortTitle}</h1><p>${listing.station} · 步行 ${listing.walkMinutes} 分钟</p></div><b>¥${candidate.agreedRent.toLocaleString("zh-CN")}<small>/月</small></b></div>
      <div class="detail-facts"><span>${listing.room.areaSqm}㎡</span><span>${listing.room.floor}/${listing.room.totalFloors} 层</span><span>${listing.room.roommateCount} 位室友</span></div>
      <div class="detail-actions"><button data-action="copy-listing">${icon("copy")}<span>复制摘要</span></button><button data-action="open-share">${icon("share")}<span>转发房源</span></button><button data-action="copy-contact">${icon("contact")}<span>${state.contactUnlocked ? "复制微信号" : "交换联系"}</span></button></div>
      ${state.contactUnlocked ? `<section class="contact-card"><span>微信号</span><b>zhunaer_demo</b><button data-action="copy-contact">复制</button></section>` : ""}
      <section class="fit-card"><header><h2>为什么合适</h2><b>${candidate.score}%</b></header>${candidate.reasons.map((item) => `<p>${item}</p>`).join("")}</section>
      <section class="notice-card"><h2>需要留意</h2>${candidate.caveats.map((item) => `<p>${item}</p>`).join("") || "<p>仍需本人现场确认</p>"}</section>
      <section class="source-card"><h2>资料来源</h2>${candidate.provenance.map((item) => `<div><span>${item.label}</span><b>${item.value}</b><em>${item.source}</em></div>`).join("")}</section>
      <section class="timeline-card"><h2>分身协商记录</h2>${candidate.negotiation.publicEvents.map((event) => `<div><i></i><span><b>${event.title}</b><p>${event.detail}</p></span></div>`).join("")}</section>
      <button class="primary-button" data-action="confirm-candidate">${state.contactUnlocked ? "已完成双方确认" : "双方确认并交换联系方式"}</button><button class="report-link" data-action="open-report">举报房源</button>
    </div>
  </section>`;
}

function createSheet() {
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>新建任务</h2><button data-action="close-sheet">${icon("close")}</button></header><button class="intent-card renter" data-action="create-renter"><span>${icon("location")}</span><div><b>我要找房</b><p>发布一条找房需求</p></div>${icon("arrow")}</button><button class="intent-card supply" data-action="create-supply"><span>${icon("home")}</span><div><b>我要出租</b><p>房东直租或个人转租</p></div>${icon("arrow")}</button></section></div>`;
}

const mapLocations = [
  ["静安寺", 18, 28], ["江苏路", 60, 24], ["南京西路", 37, 48], ["武宁路", 72, 55], ["徐家汇", 24, 74], ["隆德路", 55, 76]
];

function locationSheet() {
  return `<div class="map-modal"><section class="map-sheet"><header><button data-action="close-sheet" aria-label="返回">${icon("back")}</button><h2>选择想住的区域</h2><button data-action="confirm-location">完成</button></header><div class="map-search"><label>${icon("search")}<input name="location-query" autocomplete="off" aria-label="搜索小区、地铁站或商圈" data-input="location-search" value="${escapeHtml(state.locationSearch)}" placeholder="搜索小区、地铁站或商圈…" /></label><button data-action="locate-me" aria-label="使用当前位置">${icon("location")}<span>${state.locateState === "locating" ? "定位中" : state.locateState === "done" ? "已定位" : "定位"}</span></button></div><div class="map-canvas"><i class="river"></i><i class="road road-a"></i><i class="road road-b"></i><i class="road road-c"></i>${mapLocations.map(([name, x, y]) => `<button class="map-pin" style="--x:${x}%;--y:${y}%" data-action="toggle-location" data-value="${name}" aria-pressed="${state.selectedLocations.includes(name)}"><span></span>${name}</button>`).join("")}<div class="current-pulse ${state.locateState === "done" ? "show" : ""}"></div></div><div class="map-controls"><div class="selected-areas">${state.selectedLocations.map((name) => `<button data-action="toggle-location" data-value="${name}">${name} ${icon("close")}</button>`).join("") || "<b>点地图添加区域</b>"}</div><div class="radius-control"><span>区域半径</span>${["1", "2", "3"].map((value) => `<button data-action="set-radius" data-value="${value}" aria-pressed="${state.locationRadius === value}">${value} km</button>`).join("")}</div><button class="primary-button" data-action="confirm-location">使用这些区域</button></div></section></div>`;
}

function photoSheet() {
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet compact-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>添加房源照片</h2><button data-action="close-sheet">${icon("close")}</button></header><button class="source-option" data-action="trigger-camera">${icon("camera")}<span>拍照</span>${icon("arrow")}</button><button class="source-option" data-action="trigger-library">${icon("image")}<span>从相册选择</span>${icon("arrow")}</button><input id="camera-input" hidden type="file" accept="image/*" capture="environment" data-file="camera"/><input id="library-input" hidden type="file" accept="image/*" multiple data-file="library"/></section></div>`;
}

function shareSheet() {
  const candidate = activeCandidate();
  if (!candidate) return "";
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet compact-sheet share-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>转发房源</h2><button data-action="close-sheet" aria-label="关闭">${icon("close")}</button></header><div class="share-preview"><div class="share-preview-photo ${roomVisualClass(candidate.listing.id)}"></div><div><b>${candidate.listing.shortTitle}</b><span>¥${candidate.agreedRent.toLocaleString("zh-CN")}/月</span></div></div><button class="source-option" data-action="share-listing">${icon("share")}<span>分享房源卡片</span>${icon("arrow")}</button><button class="source-option" data-action="copy-listing">${icon("copy")}<span>复制文字摘要</span>${icon("arrow")}</button><button class="source-option" data-action="copy-contact">${icon("contact")}<span>复制联系方式</span>${icon("arrow")}</button></section></div>`;
}

function labSheet() {
  const passed = state.regression?.filter((item) => item.passed).length || 0;
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet lab-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>案例测试台</h2><button data-action="close-sheet">${icon("close")}</button></header><div class="scenario-list">${labScenarios.map((scenario) => `<button data-action="load-scenario" data-value="${scenario.id}"><span><b>${scenario.name}</b><p>${scenario.description}</p></span>${icon("arrow")}</button>`).join("")}</div><button class="secondary-button" data-action="run-regression">${state.regression ? `${passed}/${state.regression.length} 项规则通过` : "运行全部规则检查"}</button></section></div>`;
}

function reportSheet() {
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>举报房源</h2><button data-action="close-sheet">${icon("close")}</button></header>${[["broker_or_fee", "冒充个人或索取费用"], ["mismatch", "现场与信息不符"], ["stolen_photo", "盗用他人图片"], ["unavailable", "房源已不可租"]].map(([value, label]) => `<button class="report-option" data-action="set-report-type" data-value="${value}" aria-pressed="${state.reportType === value}">${label}</button>`).join("")}<label class="consent-row"><input type="checkbox" data-action="toggle-report-evidence" ${state.reportHasEvidence ? "checked" : ""}/><span>附上站内收费对话</span></label><button class="danger-button" data-action="submit-report">提交举报</button></section></div>`;
}

function reportResultSheet() {
  const confirmed = state.reportResult?.status === "identity_banned";
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>处理结果</h2><button data-action="close-sheet">${icon("close")}</button></header><div class="report-result"><span>${icon("shield")}</span><h3>${confirmed ? "账号及关联房源已冻结" : "房源已退出新匹配"}</h3><p>${state.reportResult?.finalAction}</p></div><button class="secondary-button" data-action="close-sheet">完成</button></section></div>`;
}

function activeSheet() {
  if (state.sheet === "create") return createSheet();
  if (state.sheet === "location") return locationSheet();
  if (state.sheet === "photo") return photoSheet();
  if (state.sheet === "share") return shareSheet();
  if (state.sheet === "lab") return labSheet();
  if (state.sheet === "report") return reportSheet();
  if (state.sheet === "report-result") return reportResultSheet();
  return "";
}

function render() {
  syncExpiredTask();
  document.body.dataset.motion = state.motion;
  const previousScrollTop = app.querySelector("#app-main")?.scrollTop || 0;
  const immersive = Boolean(state.flow) || state.page !== "root";
  const viewKey = [state.tab, state.flow, state.renterStage, state.supplyStage, state.page, state.activeCandidateId, state.sheet].join(":");
  const content = state.flow === "renter" ? renterFlow() : state.flow === "supply" ? supplyFlow() : state.page === "candidate" ? candidateDetail() : rootScreen();
  app.innerHTML = `<div class="device"><div class="app-shell">${statusBar()}<main id="app-main" class="screen-scroll ${immersive ? "immersive" : ""}" tabindex="-1">${content}</main>${immersive ? "" : tabBar()}${activeSheet()}${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ""}</div></div>`;
  const main = app.querySelector("#app-main");
  if (main) main.scrollTop = viewKey === lastViewKey ? previousScrollTop : 0;
  lastViewKey = viewKey;
  void mountBearAgents(app);
}

function startVoiceInput() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    app.querySelector("#demand-input")?.focus();
    showToast("当前浏览器不支持语音转写，可使用系统键盘的麦克风");
    return;
  }
  if (state.listening && voiceRecognition) {
    voiceRecognition.stop();
    state.listening = false;
    render();
    return;
  }
  voiceRecognition?.abort?.();
  voiceRecognition = new Recognition();
  voiceRecognition.lang = "zh-CN";
  voiceRecognition.interimResults = false;
  voiceRecognition.continuous = false;
  state.listening = true;
  render();
  voiceRecognition.onresult = (event) => {
    const transcript = [...event.results].map((result) => result[0]?.transcript || "").join("");
    if (transcript) state.draftText = transcript;
    state.parsedDemand = null;
    state.listening = false;
    render();
  };
  voiceRecognition.onerror = (event) => {
    state.listening = false;
    const message = event.error === "not-allowed" || event.error === "service-not-allowed"
      ? "请允许麦克风权限"
      : event.error === "no-speech"
        ? "没有听到声音"
        : "语音输入暂时不可用";
    showToast(message);
  };
  voiceRecognition.onend = () => {
    state.listening = false;
    render();
  };
  voiceRecognition.start();
}

function beginIntake() {
  if (!state.draftText.trim() && !state.selectedLocations.length) {
    showToast("先说说需求，或在地图上选区域");
    return;
  }
  state.parsedDemand = parseDemandText(state.draftText, todayInShanghai());
  state.answers = defaultAnswers();
  seedAnswersFromParsed(state.parsedDemand);
  state.consent = false;
  state.flow = "renter";
  state.renterStage = state.parsedDemand.coreMissing.length || state.parsedDemand.preferenceMissing.length ? "clarify" : "review";
  render();
}

function clearMatchTimers() {
  matchTimers.forEach((timer) => clearTimeout(timer));
  matchTimers = [];
}

function buildTask(kind, total, suitable, label) {
  return {
    id: `${kind}-${Date.now()}`,
    kind,
    label,
    phaseIndex: 0,
    scanned: 0,
    suitable: 0,
    total,
    finalSuitable: suitable,
    delivered: false,
    events: [],
    lifecycle: createTaskLifecycle(todayInShanghai())
  };
}

function startMatching(kind) {
  clearMatchTimers();
  const result = kind === "renter" ? state.result : state.supplyResult;
  const label = kind === "renter" ? mandateFromAnswers().locations.slice(0, 2).join(" / ") : `${state.supplyDraft.location}次卧`;
  state.task = buildTask(kind, result.scanned, result.candidates.length, label);
  state.tab = "match";
  state.page = "root";
  state.flow = null;
  const phases = taskPhases(kind);
  const checkpoints = [
    [600, 0.25, 0],
    [1500, 0.56, 0],
    [2700, 0.84, Math.min(1, result.candidates.length)],
    [4100, 1, result.candidates.length]
  ];
  checkpoints.forEach(([delay, ratio, suitable], index) => {
    matchTimers.push(window.setTimeout(() => {
      const [title, detail] = phases[index];
      state.task.phaseIndex = index;
      state.task.scanned = Math.min(result.scanned, Math.max(1, Math.round(result.scanned * ratio)));
      state.task.suitable = suitable;
      state.task.delivered = index === checkpoints.length - 1;
      state.task.events.push({ index: `0${index + 1}`, title, detail });
      render();
    }, delay));
  });
  render();
}

function resetAll() {
  clearMatchTimers();
  state = {
    ...state,
    tab: "match",
    flow: null,
    page: "root",
    sheet: null,
    renterStage: "input",
    supplyStage: "draft",
    draftText: "",
    parsedDemand: null,
    answers: defaultAnswers(),
    selectedLocations: [],
    consent: false,
    supplyDraft: structuredClone(startingSupplyDraft),
    supplyPledge: false,
    supplyValidation: null,
    photoPreviews: [{ src: "./assets/room-sunlit.jpg", label: "卧室" }],
    task: null,
    result: null,
    supplyResult: null,
    activeCandidateId: null,
    reportResult: null,
    taskNotices: [{ ...demoRenewalTask, lifecycle: createTaskLifecycle(addDaysToIso(todayInShanghai(), -25)) }],
    archivedTasks: [],
    messagesRead: false,
    contactUnlocked: false,
    regression: null
  };
  render();
}

app.addEventListener("input", (event) => {
  const input = event.target.closest("[data-input]");
  if (!input) return;
  const key = input.dataset.input;
  if (key === "draft-text") { state.draftText = input.value; state.parsedDemand = null; }
  if (key === "location-search") state.locationSearch = input.value;
  if (key === "budget-min") state.answers.budgetMin = input.value;
  if (key === "budget-max") state.answers.budgetMax = input.value;
  if (key === "move-in-from") state.answers.moveInFrom = input.value;
  if (key === "move-in-to") state.answers.moveInTo = input.value;
  if (key === "commute-range") { state.answers.commute = input.value; const output = app.querySelector("#commute-value"); if (output) output.textContent = `${input.value} 分钟`; }
  if (key === "supply-title") state.supplyDraft.title = input.value;
  if (key === "supply-address") state.supplyDraft.address = input.value;
  if (key === "supply-rent") { state.supplyDraft.listedRent = Number(input.value || 0); state.supplyDraft.fees.rent = Number(input.value || 0); }
  if (key === "supply-available") state.supplyDraft.availableFrom = input.value;
});

app.addEventListener("change", async (event) => {
  const input = event.target.closest("[data-file]");
  if (!input?.files?.length) return;
  const files = [...input.files].slice(0, 6);
  const previews = await Promise.all(files.map((file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ src: reader.result, label: file.name.replace(/\.[^.]+$/, "") || "房源照片" });
    reader.readAsDataURL(file);
  })));
  state.photoPreviews = [...state.photoPreviews, ...previews].slice(-6);
  state.supplyDraft.evidence.livePhotoChallenge = true;
  state.sheet = null;
  render();
});

app.addEventListener("keydown", (event) => {
  const draft = event.target.closest('[data-input="draft-text"]');
  if (draft && event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    beginIntake();
    return;
  }
  const search = event.target.closest('[data-input="location-search"]');
  if (search && event.key === "Enter" && search.value.trim()) {
    event.preventDefault();
    if (!state.selectedLocations.includes(search.value.trim())) state.selectedLocations.push(search.value.trim());
    state.locationSearch = "";
    render();
  }
});

app.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  if (target.dataset.action === "close-sheet-from-scrim" && event.target !== target) return;
  const action = target.dataset.action;
  const value = target.dataset.value;
  switch (action) {
    case "switch-tab": state.tab = value; state.page = "root"; if (value === "messages") state.messagesRead = true; render(); break;
    case "open-create": state.sheet = "create"; render(); break;
    case "close-sheet":
    case "close-sheet-from-scrim": state.sheet = null; render(); break;
    case "create-renter": state.sheet = null; state.flow = "renter"; state.renterStage = "input"; render(); break;
    case "create-supply": state.sheet = null; state.flow = "supply"; state.supplyStage = "draft"; render(); break;
    case "cancel-flow": state.flow = null; state.page = "root"; render(); break;
    case "voice-input": startVoiceInput(); break;
    case "home-intake": beginIntake(); break;
    case "start-intake": beginIntake(); break;
    case "open-location": state.sheet = "location"; render(); break;
    case "toggle-location": {
      const index = state.selectedLocations.indexOf(value);
      if (index >= 0) state.selectedLocations.splice(index, 1); else state.selectedLocations.push(value);
      state.answers.location = state.selectedLocations.join(" / ");
      render();
      break;
    }
    case "set-radius": state.locationRadius = value; render(); break;
    case "locate-me": {
      if (!navigator.geolocation) { showToast("当前设备无法定位"); break; }
      state.locateState = "locating"; render();
      navigator.geolocation.getCurrentPosition(() => { state.locateState = "done"; render(); }, () => { state.locateState = "idle"; showToast("没有获得定位权限"); }, { enableHighAccuracy: true, timeout: 8000 });
      break;
    }
    case "confirm-location": state.answers.location = state.selectedLocations.join(" / "); state.sheet = null; render(); break;
    case "set-answer": state.answers[target.dataset.key] = value; render(); break;
    case "review-mandate": { const error = validateDemandAnswers(); if (error) showToast(error); else { state.renterStage = "review"; render(); } break; }
    case "toggle-consent": state.consent = target.checked; app.querySelector('[data-action="publish-mandate"]')?.toggleAttribute("disabled", !state.consent); break;
    case "publish-mandate": {
      if (!state.consent) { showToast("请先确认需求"); break; }
      state.result = runLabScenario(state.activeScenario, mandateFromAnswers()).result;
      target.disabled = true;
      await launchBearAgent(app.querySelector('[data-bear-id="renter-review-bear"]'));
      startMatching("renter");
      break;
    }
    case "set-supply-role": state.supplyDraft.role = value; render(); break;
    case "open-photo-source": state.sheet = "photo"; render(); break;
    case "trigger-camera": app.querySelector("#camera-input")?.click(); break;
    case "trigger-library": app.querySelector("#library-input")?.click(); break;
    case "scan-supply": {
      state.supplyValidation = validateSupplyDraft(state.supplyDraft);
      if (state.supplyValidation.valid) { state.supplyStage = "review"; render(); } else showToast(state.supplyValidation.errors[0]);
      break;
    }
    case "toggle-supply-pledge": state.supplyPledge = target.checked; app.querySelector('[data-action="publish-supply"]')?.toggleAttribute("disabled", !(state.supplyPledge && validateSupplyDraft(state.supplyDraft).valid)); break;
    case "publish-supply": {
      if (!state.supplyPledge) { showToast("请先确认零中介承诺"); break; }
      state.supplyResult = matchSupplyDraft(state.supplyDraft);
      target.disabled = true;
      await launchBearAgent(app.querySelector('[data-bear-id="supply-review-bear"]'));
      startMatching("supply");
      break;
    }
    case "open-candidate": state.activeCandidateId = target.dataset.id; state.page = "candidate"; render(); break;
    case "back-root": state.page = "root"; state.tab = "results"; render(); break;
    case "confirm-candidate": state.contactUnlocked = true; showToast("联系方式已解锁"); break;
    case "contact-tenant": showToast("已发起双方确认"); break;
    case "open-share": state.sheet = "share"; render(); break;
    case "copy-listing": {
      const candidate = activeCandidate();
      if (candidate) { state.sheet = null; await copyText(listingShareText(candidate), "房源摘要已复制"); }
      break;
    }
    case "share-listing": { const candidate = activeCandidate(); if (candidate) await shareCandidate(candidate); break; }
    case "copy-contact": state.contactUnlocked = true; state.sheet = null; await copyText("zhunaer_demo", "微信号已复制"); break;
    case "open-report": state.sheet = "report"; render(); break;
    case "set-report-type": state.reportType = value; render(); break;
    case "toggle-report-evidence": state.reportHasEvidence = target.checked; break;
    case "submit-report": {
      const candidate = activeCandidate();
      if (!candidate) break;
      state.reportResult = evaluateReport({ listing: candidate.listing, reportType: state.reportType, reporterEvidence: { inAppFeeMessage: state.reportHasEvidence } });
      state.sheet = "report-result";
      render();
      break;
    }
    case "open-lab": state.sheet = "lab"; render(); break;
    case "open-insights": state.page = "insights"; render(); break;
    case "back-profile": state.page = "root"; state.tab = "profile"; render(); break;
    case "renew-task": {
      const notice = state.taskNotices.find((item) => item.id === target.dataset.id);
      if (notice) notice.lifecycle = renewTaskLifecycle(notice.lifecycle, todayInShanghai());
      showToast("已续期 30 天");
      break;
    }
    case "load-scenario": {
      const { result } = runLabScenario(value);
      clearMatchTimers();
      state.activeScenario = value;
      state.result = result;
      state.task = buildTask("renter", result.scanned, result.candidates.length, "测试案例");
      state.task.phaseIndex = 3; state.task.scanned = result.scanned; state.task.suitable = result.candidates.length; state.task.delivered = true;
      state.task.events = taskPhases("renter").map(([title, detail], index) => ({ index: `0${index + 1}`, title, detail }));
      state.tab = "results"; state.page = "root"; state.sheet = null; render();
      break;
    }
    case "run-regression": state.regression = runRegressionSuite(); render(); break;
    case "toggle-motion": state.motion = state.motion === "reduced" ? "full" : "reduced"; render(); break;
    case "reset-all": resetAll(); showToast("已重置"); break;
    default: break;
  }
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}

render();
