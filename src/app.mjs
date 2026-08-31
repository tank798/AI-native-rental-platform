import { baseMandate, labScenarios } from "./fixtures.mjs";
import { parseDemandText, parsedDemandTags } from "./demand-parser.mjs";
import { buildMandateFromConfirmedAnswers, seedAnswersFromParsed } from "./mandate-builder.mjs";
import { applyFieldProposal, confirmField } from "./field-state.mjs";
import { createEmptySupplyDraft, parseSupplyText } from "./supply-parser.mjs";
import { createClock, dateAtShanghaiNoon, daysBetweenIsoDates } from "./clock.mjs";
import {
  evaluateReport,
  matchMandate,
  matchSupplyDraft,
  runLabScenario,
  runRegressionSuite,
  validateSupplyDraft
} from "./simulation-engine.mjs";
import {
  marketplaceAreas,
  marketplaceListings,
  marketplaceTenants
} from "./marketplace-corpus.mjs";
import { bearAgentMarkup, launchBearAgent, mountBearAgents } from "./bear-agent.mjs";
import {
  addDaysToIso,
  createTaskLifecycle,
  evaluateTaskLifecycle,
  renewTaskLifecycle
} from "./task-lifecycle.mjs";
import {
  answerMatchClarification,
  confirmMatchCase,
  createServerTask,
  declineMatchCase,
  ensureServerSession,
  getEvidenceStatus,
  getMatchContact,
  getMatchCase,
  getProfileContact,
  getServerHealth,
  getServerTask,
  listTaskMatches,
  listServerTasks,
  parseRenterWithServer,
  parseSupplyWithServer,
  setProfileContact,
  setServerTaskStatus,
  uploadListingMedia,
  uploadEvidenceFile
} from "./api-client.mjs";
import { escapeAttribute, escapeText } from "./ui/safe-markup.mjs";
import { createFocusManager } from "./ui/focus-manager.mjs";
import { renderMatchDetail } from "./ui/match-detail.mjs";
import { parseRoute, pushRoute, replaceRoute } from "./ui/router.mjs";
import { renderTaskCenter } from "./ui/task-center.mjs";

const app = document.querySelector("#app");
const liveRegion = document.querySelector("#app-live-region");
const clientClock = createClock();
const focusManager = createFocusManager({ documentRef: document });

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
  elysHome: '<circle cx="12" cy="12" r="5.4" fill="currentColor" stroke="none"/><circle cx="12" cy="5.3" r="2.65" fill="currentColor" stroke="none"/><circle cx="16.75" cy="7.25" r="2.65" fill="currentColor" stroke="none"/><circle cx="18.7" cy="12" r="2.65" fill="currentColor" stroke="none"/><circle cx="16.75" cy="16.75" r="2.65" fill="currentColor" stroke="none"/><circle cx="12" cy="18.7" r="2.65" fill="currentColor" stroke="none"/><circle cx="7.25" cy="16.75" r="2.65" fill="currentColor" stroke="none"/><circle cx="5.3" cy="12" r="2.65" fill="currentColor" stroke="none"/><circle cx="7.25" cy="7.25" r="2.65" fill="currentColor" stroke="none"/>',
  elysBubble: '<path d="M5.1 4.8h13.8a2.7 2.7 0 0 1 2.7 2.7v7.1a2.7 2.7 0 0 1-2.7 2.7h-7.2l-4.5 3v-3H5.1a2.7 2.7 0 0 1-2.7-2.7V7.5a2.7 2.7 0 0 1 2.7-2.7Z" fill="currentColor" stroke="none"/>',
  elysDiamond: '<rect x="4.7" y="4.7" width="14.6" height="14.6" rx="3.2" transform="rotate(45 12 12)" fill="currentColor" stroke="none"/>',
  elysUser: '<circle cx="12" cy="7.1" r="4" fill="currentColor" stroke="none"/><path d="M4.6 20.7a7.4 7.4 0 0 1 14.8 0Z" fill="currentColor" stroke="none"/>'
};

function icon(name, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.spark}</svg>`;
}

const escapeHtml = escapeText;

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number).toLocaleString("zh-CN") : "—";
}

function todayInShanghai() {
  return clientClock.todayInShanghai();
}

function formatShortDate(isoDate) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" })
    .format(dateAtShanghaiNoon(isoDate));
}

function defaultAnswers() {
  return {
    city: "上海",
    location: "",
    commuteDestinations: [],
    budgetMin: "",
    budgetMax: "",
    moveInFrom: "",
    moveInTo: "",
    commute: "35",
    leaseMonths: "any",
    roommate: "any",
    floor: "any",
    exposure: "any",
    viewing: "any",
    bathroom: "any",
    elevator: "any",
    utilities: "any",
    kitchen: "any",
    washer: "any",
    washerType: "any",
    network: "any"
  };
}

function freshSupplyDraft() {
  return createEmptySupplyDraft();
}

const demoRenewalTask = {
  id: "renewal-demo",
  kind: "supply",
  label: "静安寺次卧",
  lifecycle: createTaskLifecycle(addDaysToIso(todayInShanghai(), -25))
};

const STORAGE_KEY = "zhunaer-product-state-v1";

function defaultProductStats() {
  return {
    joinedAt: todayInShanghai(),
    tasksCreated: 0,
    scanned: 0,
    suitable: 0,
    confirmed: 0,
    avoidedMessages: 0,
    dailyScanned: [0, 0, 0, 0, 0, 0, 0]
  };
}

function defaultSettings() {
  return {
    expiryReminder: true,
    candidateNotifications: true,
    privateNegotiation: true
  };
}

function initialProductState() {
  return {
    tab: "match",
    flow: null,
    page: "root",
    sheet: null,
    renterStage: "input",
    supplyStage: "input",
    draftText: "",
    parsedDemand: null,
    supplyText: "",
    parsedSupply: null,
    listening: false,
    answers: defaultAnswers(),
    renterFieldStates: {},
    renterInputVersion: 0,
    selectedLocations: [],
    locationSearch: "",
    locationRadius: "2",
    locateState: "idle",
    consent: false,
    supplyDraft: freshSupplyDraft(),
    supplyFieldStates: {},
    supplyInputVersion: 0,
    supplyPledge: false,
    supplyValidation: null,
    supplyEvidenceRefs: {},
    evidenceUploading: null,
    intakeProvider: null,
    intakeLoading: false,
    serverReady: false,
    syncError: null,
    connection: {
      phase: "connecting",
      message: "正在连接服务",
      lastSuccessAt: null
    },
    fieldErrors: {},
    marketMode: "real",
    demoBanner: false,
    photoPreviews: [],
    publicPhotoConsent: false,
    task: null,
    tasks: [],
    activeTaskId: null,
    taskCenterLoading: false,
    taskCenterError: null,
    routeNotice: null,
    result: null,
    supplyResult: null,
    activeCandidateId: null,
    activeMatchCase: null,
    activeMatchCaseLoading: false,
    activeMatchCaseError: null,
    clarificationSubmitting: null,
    contactProfile: null,
    contactDraft: "",
    revealedContact: null,
    contactLoading: false,
    contactSubmitting: false,
    reportType: "broker_or_fee",
    reportHasEvidence: false,
    reportResult: null,
    taskNotices: [structuredClone(demoRenewalTask)],
    archivedTasks: [],
    messagesRead: false,
    activeScenario: "full-demo",
    regression: null,
    toast: null,
    motion: "full",
    stats: defaultProductStats(),
    settings: defaultSettings()
  };
}

function restoreProductState() {
  const fallback = initialProductState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return fallback;
    const activeTaskId = typeof saved.activeTaskId === "string" ? saved.activeTaskId : null;
    return { ...fallback, activeTaskId };
  } catch {
    return fallback;
  }
}

function persistProductState() {
  try {
    // The server is authoritative; local storage remembers only which owned
    // task the user last focused and never caches task or candidate payloads.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeTaskId: state.activeTaskId || null }));
  } catch {
    // Storage can be unavailable in strict privacy modes; the current session still works.
  }
}

let state = restoreProductState();

let voiceRecognition = null;
let toastTimer = null;
let lastViewKey = null;
let matchTimers = [];
let taskPollTimer = null;
let lastAnnouncedMessage = "";
let lastRenderedSheet = null;
let modalTriggerFocusKey = null;
let pendingFocusRestoreKey = null;
let pendingInvalidFocus = false;
let recoveryExpected = false;

if (state.task?.remoteId && !state.task.delivered) {
  const restoredResult = state.task.kind === "renter" ? state.result : state.supplyResult;
  state.task.phaseIndex = 3;
  state.task.scanned = state.task.total;
  state.task.suitable = state.task.finalSuitable;
  state.task.delivered = true;
  if (restoredResult) commitCompletedTask(restoredResult);
}

function daysBetween(start, end) {
  return Math.max(1, daysBetweenIsoDates(start, end) + 1);
}

function visibleStats() {
  const pendingScanned = state.task && !state.task.statsCommitted ? state.task.scanned : 0;
  const pendingSuitable = state.task && !state.task.statsCommitted ? state.task.suitable : 0;
  return {
    ...state.stats,
    joinedDays: daysBetween(state.stats.joinedAt, todayInShanghai()),
    scanned: state.stats.scanned + pendingScanned,
    suitable: state.stats.suitable + pendingSuitable
  };
}

function commitCompletedTask(result) {
  if (!state.task || state.task.statsCommitted) return;
  state.stats.scanned += result.scanned;
  state.stats.suitable += result.candidates.length;
  state.stats.avoidedMessages += Math.max(0, result.scanned * 2 - result.candidates.length);
  state.stats.dailyScanned = [...state.stats.dailyScanned.slice(-6), result.scanned];
  state.task.statsCommitted = true;
}

function showToast(message) {
  state.toast = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, 2200);
}

function announce(message) {
  if (!message || message === lastAnnouncedMessage || !liveRegion) return;
  lastAnnouncedMessage = message;
  liveRegion.textContent = "";
  window.requestAnimationFrame(() => {
    liveRegion.textContent = message;
  });
}

function markConnectionSuccess() {
  const previousPhase = state.connection.phase;
  state.serverReady = true;
  state.syncError = null;
  state.connection = {
    phase: "online",
    message: "连接正常",
    lastSuccessAt: clientClock.nowIso()
  };
  if (["offline", "degraded"].includes(previousPhase) || recoveryExpected) announce("连接已恢复");
  recoveryExpected = false;
}

function markConnectionDegraded(message = "AI 暂时不可用，已使用确定性解析") {
  state.serverReady = true;
  state.syncError = message;
  state.connection = {
    ...state.connection,
    phase: "degraded",
    message
  };
  announce(message);
}

function markConnectionOffline(error) {
  const message = error?.message || String(error || "暂时无法连接服务");
  state.serverReady = false;
  state.syncError = message;
  state.connection = {
    ...state.connection,
    phase: "offline",
    message
  };
  announce(`连接中断：${message}`);
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
  if (state.task.remoteId && state.task.status !== "active") {
    clearTaskPolling();
    if (state.task.status !== "expired") return;
  }
  const lifecycleState = evaluateTaskLifecycle(state.task.lifecycle, todayInShanghai());
  if (!lifecycleState.expired) return;
  if (state.task.remoteId) clearTaskPolling();
  state.archivedTasks.push({ ...state.task, archivedReason: "expired" });
  state.task = null;
  state.result = null;
  state.supplyResult = null;
  state.activeCandidateId = null;
  state.activeMatchCase = null;
  state.activeMatchCaseLoading = false;
  state.activeMatchCaseError = null;
}

function mandateFromAnswers() {
  return buildMandateFromConfirmedAnswers({
    answers: state.answers,
    selectedLocations: state.selectedLocations,
    city: state.answers.city,
    baseMandate
  });
}

function proposedFieldStates(values) {
  return Object.fromEntries(Object.entries(values).map(([fieldKey, value]) => [
    fieldKey,
    applyFieldProposal(null, { value, source: "intake", confidence: null })
  ]));
}

function confirmRenterAnswer(fieldKey, value) {
  state.answers[fieldKey] = value;
  state.renterFieldStates[fieldKey] = confirmField(state.renterFieldStates[fieldKey], value);
  state.renterInputVersion += 1;
  const validationKey = {
    location: "location",
    budgetMin: "budget",
    budgetMax: "budget",
    moveInFrom: "moveIn",
    moveInTo: "moveIn",
    commute: "commute",
    leaseMonths: "lease"
  }[fieldKey];
  if (validationKey && state.fieldErrors[validationKey]) refreshDemandFieldError(validationKey);
}

function confirmSupplyField(fieldKey, value) {
  state.supplyFieldStates[fieldKey] = confirmField(state.supplyFieldStates[fieldKey], value);
  state.supplyInputVersion += 1;
}

function validateDemandFields() {
  const mandate = mandateFromAnswers();
  const errors = {};
  if (!mandate.locations.length) errors.location = "请在地图上选择区域";
  if (!mandate.budget.target || !mandate.budget.hardMax) errors.budget = "请填写月租范围";
  else if (mandate.budget.target < 500 || mandate.budget.hardMax < mandate.budget.target) errors.budget = "月租范围需要从低到高";
  if (!mandate.moveInWindow?.from || !mandate.moveInWindow?.to) errors.moveIn = "请填写入住日期范围";
  else if (mandate.moveInWindow.to < mandate.moveInWindow.from) errors.moveIn = "最晚入住日期不能早于最早日期";
  if (mandate.maxCommuteMinutes < 15 || mandate.maxCommuteMinutes > 60) errors.commute = "通勤时间需在 15 到 60 分钟之间";
  if (!mandate.leaseFlexible && ![3, 6, 12].includes(Number(mandate.leaseMonths))) errors.lease = "请选择租期";
  return errors;
}

function refreshDemandFieldError(fieldKey) {
  const message = validateDemandFields()[fieldKey];
  if (message) state.fieldErrors[fieldKey] = message;
  else delete state.fieldErrors[fieldKey];
  applyFieldErrorAttributes();
  if (!message) {
    app.querySelector(`#field-error-${fieldKey}`)?.remove();
    app.querySelector(`[data-field-group="${fieldKey}"]`)?.classList.remove("has-error");
  }
}

function validateContactValue(type, value) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return "请先填写联系方式";
  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(cleanValue)) return "请填写有效的邮箱地址";
  if (type === "phone" && cleanValue.replace(/\D/gu, "").length < 7) return "手机号至少需要 7 位数字";
  if (type === "wechat" && cleanValue.length < 4) return "微信号至少需要 4 个字符";
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
    ["results", "elysBubble", "候选"],
    ["messages", "elysDiamond", "消息"],
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
      <textarea id="demand-input" name="rental-demand" autocomplete="off" data-input="draft-text" aria-label="输入找房需求" placeholder="位置、预算、入住时间，想到什么就说什么">${escapeHtml(state.draftText)}</textarea>
      <div class="composer-footer">
        <button class="round-control ${state.listening ? "is-listening" : ""}" data-action="voice-input" aria-label="语音输入">${icon("mic")}</button>
        <button class="composer-next" data-action="start-intake" ${state.intakeLoading ? "disabled" : ""}>${state.intakeLoading ? "AI 整理中" : `继续 ${icon("arrow")}`}</button>
      </div>
    </div>
    <button class="map-entry" data-action="open-location">
      <span>${icon("map")}<b>${state.selectedLocations.length ? escapeText(state.selectedLocations.join("、")) : "也可以直接在地图上选"}</b></span>${icon("arrow")}
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
      body: `<button class="location-picker-row" data-action="open-location"><span>${icon("map")}<b>${state.selectedLocations.length ? escapeText(state.selectedLocations.join("、")) : "打开地图选择"}</b></span>${icon("arrow")}</button>`
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
      body: `<div class="range-control"><output id="commute-value">${escapeText(state.answers.commute)} 分钟</output><input type="range" min="15" max="60" step="5" data-input="commute-range" value="${escapeAttribute(state.answers.commute)}" /><div><span>15</span><span>60 分钟</span></div></div>`
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

function fieldErrorMarkup(fieldKey) {
  const message = state.fieldErrors[fieldKey];
  return message
    ? `<p class="field-error" id="field-error-${escapeAttribute(fieldKey)}">${escapeText(message)}</p>`
    : "";
}

function renterClarify() {
  const parsed = state.parsedDemand || parseDemandText(state.draftText, todayInShanghai());
  const tags = parsedDemandTags(parsed);
  const today = todayInShanghai();
  const missing = new Set(parsed.coreMissing);
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.filter((question) => question?.fieldKey && question?.question).slice(0, 3)
    : [];
  const questionMarkup = questions.length
    ? `<div class="clarification-prompts">${questions.map((question) => `<p data-field-key="${escapeAttribute(question.fieldKey)}">${escapeText(question.question)}</p>`).join("")}</div>`
    : "<b>再确认一下</b>";
  const field = (key, label, body) => `<div class="dialogue-field ${missing.has(key) ? "is-missing" : ""} ${state.fieldErrors[key] ? "has-error" : ""}" data-field-group="${escapeAttribute(key)}"><b>${label}</b><div>${body}</div>${fieldErrorMarkup(key)}</div>`;
  return `<section class="flow-screen">
    ${flowHeader("和找房分身确认")}
    <div class="rental-chat">
      <div class="chat-line is-user"><div class="chat-bubble">${escapeHtml(state.draftText || state.selectedLocations.join("、"))}</div></div>
      <div class="chat-line is-agent"><span class="chat-avatar"><img src="./assets/bear-agent-anchor.png" width="36" height="41" alt="" /></span><div class="chat-bubble"><b>我先整理成这样</b><div class="chat-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") || "<span>等你补充</span>"}</div><small class="intake-source">${state.intakeProvider === "siliconflow" ? "AI 结构化 · 规则复核" : "确定性解析 · 安全模式"}</small></div></div>
      <div class="chat-line is-agent is-form"><span class="chat-avatar"><img src="./assets/bear-agent-anchor.png" width="36" height="41" alt="" /></span><div class="chat-bubble dialogue-card">${questionMarkup}
        <div class="dialogue-fields">
          ${field("location", "区域", `<button class="dialogue-location" data-action="open-location"><span>${state.selectedLocations.length ? escapeText(state.selectedLocations.join("、")) : "打开地图选择"}</span>${icon("arrow")}</button>`)}
          ${field("budget", "预算", `<div class="paired-inputs"><label><span>理想</span><div class="money-input"><b>¥</b><input type="number" min="500" step="100" inputmode="numeric" data-input="budget-min" value="${escapeHtml(state.answers.budgetMin)}" placeholder="3000" /></div></label><i>—</i><label><span>最高</span><div class="money-input"><b>¥</b><input type="number" min="500" step="100" inputmode="numeric" data-input="budget-max" value="${escapeHtml(state.answers.budgetMax)}" placeholder="4000" /></div></label></div>`)}
          ${field("moveIn", "入住", `<div class="paired-inputs date-pair"><label><span>最早</span><input type="date" min="${today}" data-input="move-in-from" value="${escapeHtml(state.answers.moveInFrom)}" /></label><i>—</i><label><span>最晚</span><input type="date" min="${escapeHtml(state.answers.moveInFrom || today)}" data-input="move-in-to" value="${escapeHtml(state.answers.moveInTo)}" /></label></div>`)}
          ${field("housing", "居住", `<div class="choice-grid">${answerChip("roommate", "no_share", "整租")}${answerChip("roommate", "female", "女生合租")}${answerChip("roommate", "male", "男生合租")}${answerChip("roommate", "any", "不限")}</div>`)}
          ${field("commute", "通勤", `<div class="range-control"><output id="commute-value">${escapeText(state.answers.commute)} 分钟</output><input type="range" min="15" max="60" step="5" data-input="commute-range" value="${escapeAttribute(state.answers.commute)}" /><div><span>15</span><span>60 分钟</span></div></div>`)}
          ${field("lease", "租期", `<div class="choice-grid is-four">${answerChip("leaseMonths", "3", "3 个月")}${answerChip("leaseMonths", "6", "6 个月")}${answerChip("leaseMonths", "12", "1 年")}${answerChip("leaseMonths", "any", "不限")}</div>`)}
          ${field("floor", "楼层", `<div class="choice-grid is-four">${answerChip("floor", "low", "低层")}${answerChip("floor", "middle", "中层")}${answerChip("floor", "high", "高层")}${answerChip("floor", "any", "不限")}</div>`)}
          ${field("exposure", "朝向", `<div class="choice-grid is-four">${answerChip("exposure", "south", "朝南")}${answerChip("exposure", "east", "朝东")}${answerChip("exposure", "west", "朝西")}${answerChip("exposure", "any", "不限")}</div>`)}
          ${field("viewing", "看房", `<div class="choice-grid is-three">${answerChip("viewing", "weekday_evening", "工作日晚")}${answerChip("viewing", "weekend", "周末")}${answerChip("viewing", "any", "不限")}</div>`)}
          <div class="dialogue-preferences">
            ${preferenceRow("ensuite")}${preferenceRow("elevator")}${preferenceRow("utilities")}${preferenceRow("kitchen")}${preferenceRow("washer")}
            <div class="preference-row"><b>洗衣机</b><div>${answerChip("washerType", "drum", "滚筒")}${answerChip("washerType", "pulsator", "波轮")}${answerChip("washerType", "any", "不限")}</div></div>
            <div class="preference-row"><b>网络</b><div>${answerChip("network", "required", "需要")}${answerChip("network", "preferred", "优先")}${answerChip("network", "any", "不限")}</div></div>
          </div>
        </div>
      </div></div>
    </div>
    <div class="flow-bottom"><button class="primary-button" data-action="review-mandate">确认需求 ${icon("arrow")}</button></div>
  </section>`;
}

function renterReview() {
  const mandate = mandateFromAnswers();
  const roommate = mandate.sharedHousing === false ? "整租" : mandate.roommateGender === "female" ? "女生合租" : mandate.roommateGender === "male" ? "男生合租" : "整租合租都可";
  const budget = `¥${mandate.budget.target.toLocaleString("zh-CN")}—${mandate.budget.hardMax.toLocaleString("zh-CN")}`;
  const dates = `${mandate.moveInWindow.from?.slice(5).replace("-", ".")}—${mandate.moveInWindow.to?.slice(5).replace("-", ".")}`;
  const lease = mandate.leaseFlexible ? "灵活" : `${mandate.leaseMonths} 个月`;
  const homeDetails = [
    { low: "低楼层", middle: "中楼层", high: "高楼层" }[state.answers.floor],
    { south: "朝南", east: "朝东", west: "朝西" }[state.answers.exposure]
  ].filter(Boolean).join("、") || "不限";
  const viewing = { weekday_evening: "工作日晚", weekend: "周末", any: "时间灵活" }[state.answers.viewing];
  return `<section class="flow-screen">
    ${flowHeader("确认找房任务")}
    <div class="review-title"><span class="flow-kicker">即将启动</span><h1>${escapeText(mandate.locations.join("、"))}</h1></div>
    <dl class="review-list">
      <div><dt>预算</dt><dd>${budget} / 月</dd></div>
      <div><dt>入住</dt><dd>${dates}</dd></div>
      <div><dt>通勤</dt><dd>${mandate.maxCommuteMinutes} 分钟内</dd></div>
      <div><dt>居住</dt><dd>${roommate}</dd></div>
      <div><dt>租期</dt><dd>${lease}</dd></div>
      <div><dt>房屋</dt><dd>${homeDetails}</dd></div>
      <div><dt>看房</dt><dd>${viewing}</dd></div>
    </dl>
    <section class="private-panel">
      <header>${icon("lock")}<h2>议价范围</h2></header>
      <div><span><b>¥${mandate.budget.target.toLocaleString("zh-CN")}</b>目标</span><span><b>¥${mandate.budget.hardMax.toLocaleString("zh-CN")}</b>上限</span></div>
    </section>
    <label class="consent-row"><input type="checkbox" name="demand-confirmed" data-action="toggle-consent" ${state.consent ? "checked" : ""}/><span>以上条件无误</span></label>
    <div class="launch-preview">${bearAgentMarkup({ id: "renter-review-bear", mode: "idle", compact: true, label: "等待出发的找房小熊" })}<span>准备出发</span></div>
    <div class="flow-bottom"><button class="primary-button" data-action="publish-mandate" data-bear-hover-for="renter-review-bear" ${state.consent ? "" : "disabled"}>交给小熊</button></div>
  </section>`;
}

function supplyChoice(key, value, label, activeValue) {
  return `<button class="choice-chip" data-action="set-supply-detail" data-key="${key}" data-value="${value}" aria-pressed="${String(activeValue) === String(value)}">${label}</button>`;
}

function evidenceUploadRow(kind, title, detail, accept = "image/*,application/pdf") {
  const submitted = Boolean(state.supplyEvidenceRefs[kind]);
  const verification = state.supplyDraft.verification?.[kind];
  const verified = verification?.verificationStatus === "verified";
  const uploading = state.evidenceUploading === kind;
  const statusLabel = verification?.displayLabel || (submitted ? "已上传，待审核" : detail);
  return `<div class="evidence-upload-row ${verified ? "is-complete" : submitted ? "is-pending" : ""}">
    <span>${verified ? icon("check") : icon("shield")}</span>
    <div><b>${title}</b><p>${escapeHtml(statusLabel)}</p></div>
    <button data-action="trigger-evidence" data-value="${kind}" ${uploading ? "disabled" : ""}>${uploading ? "上传中" : submitted ? "更换" : "上传"}</button>
    <input id="evidence-${kind}" hidden type="file" accept="${accept}" data-evidence-file="${kind}" />
  </div>`;
}

async function refreshSupplyVerificationStatuses() {
  const entries = Object.entries(state.supplyEvidenceRefs);
  if (!entries.length) return;
  const statuses = await Promise.all(entries.map(async ([kind, evidenceId]) => [kind, await getEvidenceStatus(evidenceId)]));
  state.supplyDraft.verification = Object.fromEntries(statuses);
}

function supplyInputScreen() {
  return `<section class="flow-screen renter-input-screen">
    ${flowHeader("发布房源")}
    <div class="rental-chat supply-intake-chat">
      <div class="chat-line is-agent"><span class="chat-avatar"><img src="./assets/bear-agent-anchor.png" width="36" height="41" alt="" /></span><div class="chat-bubble"><b>把房子的情况发给我</b></div></div>
    </div>
    <div class="composer-card supply-composer" data-filled="${Boolean(state.supplyText.trim())}">
      <textarea id="supply-input" name="rental-supply" autocomplete="off" data-input="supply-text" aria-label="输入房源信息" placeholder="位置、租金、入住时间、室友和设施，想到什么就说什么">${escapeHtml(state.supplyText)}</textarea>
      <div class="composer-footer"><span></span><button class="composer-next" data-action="start-supply-intake" ${state.intakeLoading ? "disabled" : ""}>${state.intakeLoading ? "AI 整理中" : `继续 ${icon("arrow")}`}</button></div>
    </div>
  </section>`;
}

function seedSupplyFromParsed(parsed) {
  const fields = parsed?.fields;
  if (!fields) return;
  const draft = freshSupplyDraft();
  if (fields.role) draft.role = fields.role;
  if (fields.district) draft.district = fields.district;
  if (fields.location) draft.location = fields.location;
  if (fields.station) draft.station = fields.station;
  if (fields.listedRent) {
    draft.listedRent = fields.listedRent;
    draft.fees.rent = fields.listedRent;
    draft.fees.deposit = fields.listedRent;
  }
  if (fields.minRent) draft.minimumAuthorizedRent = fields.minRent;
  if (fields.availableFrom) draft.availableFrom = fields.availableFrom;
  if (Number.isFinite(fields.room.areaSqm)) draft.areaSqm = fields.room.areaSqm;
  if (Number.isFinite(fields.room.floor)) draft.floor = fields.room.floor;
  if (Number.isFinite(fields.room.totalFloors)) draft.totalFloors = fields.room.totalFloors;
  if (Number.isFinite(fields.room.roommateCount)) draft.roommateCount = fields.room.roommateCount;
  if (fields.room.roommateGender) draft.roommateGender = fields.room.roommateGender;
  Object.entries(fields.facilities).forEach(([key, value]) => {
    if (value !== null && value !== undefined && key in draft.facilities) draft.facilities[key] = value;
  });
  if (fields.facilities.utilities === "residential") draft.fees.utilities = "民水民电按账单均摊";
  if (fields.fees.service !== null) draft.fees.service = fields.fees.service;
  if (fields.fees.intermediary !== null) draft.fees.intermediary = fields.fees.intermediary;
  draft.title = fields.location
    ? `${fields.location} · ${fields.role === "landlord" ? "房东直租" : fields.role === "subletter" ? "个人转租" : "待核验房源"}`
    : "个人房源";
  state.supplyDraft = draft;
}

function supplyDraftScreen() {
  const draft = state.supplyDraft;
  const roleLabel = draft.role === "landlord" ? "房东本人" : draft.role === "subletter" ? "当前租客" : draft.role === "broker" ? "疑似中介" : "身份待确认";
  const tags = [roleLabel, draft.location, draft.listedRent ? `¥${draft.listedRent}/月` : null, draft.availableFrom].filter(Boolean);
  const locations = marketplaceAreas.map((area) => `<option value="${escapeAttribute(area.location)}" ${area.location === draft.location ? "selected" : ""}>${escapeText(area.location)} · ${escapeText(area.station)}</option>`).join("");
  return `<section class="flow-screen">
    ${flowHeader("和出租分身确认")}
    <div class="rental-chat supply-chat">
      <div class="chat-line is-user"><div class="chat-bubble">${escapeHtml(state.supplyText)}</div></div>
      <div class="chat-line is-agent"><span class="chat-avatar"><img src="./assets/bear-agent-anchor.png" width="36" height="41" alt="" /></span><div class="chat-bubble"><b>我先整理成这样</b><div class="chat-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div><small class="intake-source">${state.intakeProvider === "siliconflow" ? "AI 结构化 · 规则复核" : "确定性解析 · 安全模式"}</small></div></div>
      <div class="chat-line is-agent is-form"><span class="chat-avatar"><img src="./assets/bear-agent-anchor.png" width="36" height="41" alt="" /></span><div class="chat-bubble dialogue-card"><b>再确认一下</b>
        <div class="dialogue-fields supply-dialogue-fields">
          <div class="dialogue-field"><b>身份</b><div class="role-options"><button data-action="set-supply-role" data-value="landlord" aria-pressed="${draft.role === "landlord"}">房东本人</button><button data-action="set-supply-role" data-value="subletter" aria-pressed="${draft.role === "subletter"}">当前租客</button></div></div>
          <div class="dialogue-field"><b>区域</b><select data-input="supply-location" aria-label="房源区域"><option value="">请选择</option>${locations}</select></div>
          <div class="dialogue-field"><b>房源</b><div class="stacked-inputs"><label><span>一句话</span><input data-input="supply-title" value="${escapeHtml(draft.title)}" /></label><label><span>完整地址</span><textarea data-input="supply-address">${escapeHtml(draft.address)}</textarea></label></div></div>
          <div class="dialogue-field"><b>租金</b><div class="paired-inputs"><label><span>挂牌</span><div class="money-input"><b>¥</b><input type="number" inputmode="numeric" data-input="supply-rent" value="${escapeAttribute(draft.listedRent || "")}" /></div></label><i>—</i><label><span>最低授权</span><div class="money-input"><b>¥</b><input type="number" inputmode="numeric" data-input="supply-min-rent" value="${escapeAttribute(draft.minimumAuthorizedRent || "")}" /></div></label></div></div>
          <div class="dialogue-field"><b>入住与租期</b><div class="paired-inputs"><label><span>可入住</span><input type="date" min="${todayInShanghai()}" data-input="supply-available" value="${escapeHtml(draft.availableFrom)}" /></label><i>—</i><label><span>最短租期</span><select data-input="supply-lease"><option value="" ${draft.leaseMonthsMin === null ? "selected" : ""} disabled>请确认</option><option value="3" ${draft.leaseMonthsMin === 3 ? "selected" : ""}>3 个月</option><option value="6" ${draft.leaseMonthsMin === 6 ? "selected" : ""}>6 个月</option><option value="12" ${draft.leaseMonthsMin === 12 ? "selected" : ""}>1 年</option></select></label></div></div>
          <div class="dialogue-field"><b>房间</b><div class="triple-inputs"><label><span>面积</span><input type="number" data-input="supply-area" value="${escapeAttribute(draft.areaSqm || "")}" /></label><label><span>楼层</span><input type="number" data-input="supply-floor" value="${escapeAttribute(draft.floor || "")}" /></label><label><span>总层</span><input type="number" data-input="supply-total-floors" value="${escapeAttribute(draft.totalFloors || "")}" /></label></div></div>
          <div class="dialogue-field"><b>室友</b><div class="roommate-controls"><input type="number" min="0" max="8" data-input="supply-roommate-count" aria-label="室友人数" value="${escapeAttribute(draft.roommateCount ?? "")}" /><div class="choice-grid is-three">${supplyChoice("roommateGender", "female", "女生", draft.roommateGender)}${supplyChoice("roommateGender", "male", "男生", draft.roommateGender)}${supplyChoice("roommateGender", "any", "不限", draft.roommateGender || "any")}</div></div></div>
          <div class="dialogue-field"><b>朝向</b><div class="choice-grid is-four">${supplyChoice("exposure", "south", "朝南", draft.facilities.exposure)}${supplyChoice("exposure", "east", "朝东", draft.facilities.exposure)}${supplyChoice("exposure", "west", "朝西", draft.facilities.exposure)}${supplyChoice("exposure", "unknown", "不限", draft.facilities.exposure)}</div></div>
          <div class="dialogue-field"><b>设施</b><div class="supply-facility-grid">${supplyChoice("kitchen", "true", "厨房", String(draft.facilities.kitchen))}${supplyChoice("washer", "true", "洗衣机", String(draft.facilities.washer))}${supplyChoice("elevator", "true", "电梯", String(draft.facilities.elevator))}${supplyChoice("ensuite", "true", "独卫", String(draft.facilities.ensuite))}</div></div>
          <div class="dialogue-field"><b>洗衣机</b><div class="choice-grid is-three">${supplyChoice("washerType", "drum", "滚筒", draft.facilities.washerType)}${supplyChoice("washerType", "pulsator", "波轮", draft.facilities.washerType)}${supplyChoice("washerType", "unknown", "不限", draft.facilities.washerType)}</div></div>
          <div class="dialogue-field"><b>网络</b><div class="choice-grid is-three">${supplyChoice("network", "included", "已包含", draft.facilities.network)}${supplyChoice("network", "shared", "另计", draft.facilities.network)}${supplyChoice("network", "unknown", "待确认", draft.facilities.network)}</div></div>
          <div class="dialogue-field"><b>看房</b><div class="choice-grid is-three">${supplyChoice("viewingAvailability", "weekday_evening", "工作日晚", draft.viewingAvailability)}${supplyChoice("viewingAvailability", "weekend", "周末", draft.viewingAvailability)}${supplyChoice("viewingAvailability", "any", "不限", draft.viewingAvailability)}</div></div>
        </div>
      </div></div>
    </div>
    <section class="form-section photo-section conversational-photo"><div class="section-title"><h2>房源现场</h2><button data-action="open-photo-source">添加</button></div><div class="photo-grid">${state.photoPreviews.map((photo) => `<figure><img src="${escapeAttribute(photo.src)}" width="240" height="180" loading="lazy" alt="${escapeAttribute(photo.label)}"/><figcaption>${escapeText(photo.label)}</figcaption></figure>`).join("")}<button class="add-photo" data-action="open-photo-source">${icon("plus")}<span>拍摄或选择</span></button></div><label class="consent-row public-photo-consent"><input type="checkbox" data-action="toggle-photo-consent" ${state.publicPhotoConsent ? "checked" : ""} ${state.photoPreviews.length ? "" : "disabled"}/><span>同意将净化并移除位置元数据后的照片展示给匹配候选</span></label></section>
    <section class="form-section evidence-upload-panel"><div class="section-title"><h2>发布材料</h2><span>仅用于平台核验</span></div>
      ${evidenceUploadRow("identity", "身份材料", "身份证明图片或 PDF")}
      ${evidenceUploadRow("roleDocument", "发布角色材料", draft.role === "landlord" ? "产权人与发布人关系材料" : "当前承租人身份材料")}
      ${evidenceUploadRow("rightsDocument", "出租权材料", draft.role === "landlord" ? "产权证明" : "有效租约及转租授权")}
      ${evidenceUploadRow("livePhotoChallenge", "房屋现场照片", "请使用上方拍摄或选择真实照片", "image/*")}
    </section>
    <div class="flow-bottom"><button class="primary-button" data-action="scan-supply">确认房源 ${icon("arrow")}</button></div>
  </section>`;
}

function supplyReviewScreen() {
  const validation = state.supplyValidation || validateSupplyDraft(state.supplyDraft);
  const roommate = state.supplyDraft.roommateCount
    ? `${state.supplyDraft.roommateCount} 位${state.supplyDraft.roommateGender === "male" ? "男生" : state.supplyDraft.roommateGender === "female" ? "女生" : ""}室友`
    : "整租";
  const facilities = [["kitchen", "厨房"], ["washer", "洗衣机"], ["elevator", "电梯"], ["ensuite", "独卫"]]
    .filter(([key]) => state.supplyDraft.facilities[key])
    .map(([, label]) => label)
    .join("、") || "基础设施待确认";
  return `<section class="flow-screen">
    ${flowHeader("确认出租任务")}
    <div class="review-title"><h1>${escapeHtml(state.supplyDraft.location)}个人房源</h1></div>
    <dl class="review-list"><div><dt>身份</dt><dd>${state.supplyDraft.role === "landlord" ? "房东本人" : "当前租客"}</dd></div><div><dt>挂牌</dt><dd>¥${state.supplyDraft.listedRent.toLocaleString("zh-CN")} / 月</dd></div><div><dt>入住</dt><dd>${escapeText(state.supplyDraft.availableFrom)}</dd></div><div><dt>租期</dt><dd>至少 ${escapeText(state.supplyDraft.leaseMonthsMin)} 个月</dd></div><div><dt>房间</dt><dd>${escapeText(state.supplyDraft.areaSqm)}㎡ · ${escapeText(state.supplyDraft.floor)}/${escapeText(state.supplyDraft.totalFloors)} 层</dd></div><div><dt>室友</dt><dd>${escapeText(roommate)}</dd></div><div><dt>设施</dt><dd>${escapeText(facilities)}</dd></div></dl>
    <section class="private-panel"><header>${icon("lock")}<h2>议价范围</h2></header><div><span><b>¥${state.supplyDraft.listedRent.toLocaleString("zh-CN")}</b>挂牌</span><span><b>¥${state.supplyDraft.minimumAuthorizedRent.toLocaleString("zh-CN")}</b>底价</span></div></section>
    ${validation.errors.length ? `<div class="error-banner">${escapeText(validation.errors.join("；"))}</div>` : ""}
    <label class="consent-row"><input type="checkbox" name="zero-fee-pledge" data-action="toggle-supply-pledge" ${state.supplyPledge ? "checked" : ""}/><span>不收取任何中介费或服务费</span></label>
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
  if (state.supplyStage === "review") return supplyReviewScreen();
  if (state.supplyStage === "draft") return supplyDraftScreen();
  return supplyInputScreen();
}

function matchingVisual(kind) {
  return `<div class="bear-search-field simple-search-field" data-kind="${kind}">
    <span class="agent-breathing-light" aria-hidden="true"><i></i><i></i><i></i></span>
    ${bearAgentMarkup({ id: "matching-bear", mode: "searching", label: kind === "renter" ? "持续寻找房源的小熊" : "持续寻找租客的小熊" })}
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
        <div><button class="round-control voice-control ${state.listening ? "is-listening" : ""}" data-action="voice-input" aria-label="${state.listening ? "停止语音输入" : "语音输入"}" aria-pressed="${state.listening}" title="${state.listening ? "停止语音输入" : "语音输入"}">${icon("mic")}</button><button class="home-start" data-action="home-intake" data-bear-hover-for="home-bear" ${state.intakeLoading ? "disabled" : ""}>${state.intakeLoading ? "AI 整理中" : `开始找房 ${icon("arrow")}`}</button></div>
      </div>
      <button class="home-supply-entry" data-action="create-supply">有房要出租 ${icon("arrow")}</button>
    </section>`;
  }
  const title = state.task.kind === "renter" ? "仍在持续找房" : "仍在持续找租客";
  return `<section class="match-home">
    ${matchingVisual(state.task.kind)}
    <div class="agent-status" role="status" aria-live="polite"><p>${title}</p></div>
    <div class="match-metrics"><span><b>${escapeText(state.task.scanned)}</b>已查看</span><span><b>${escapeText(state.task.suitable)}</b>合适</span></div>
  </section>`;
}

function primaryListingPhoto(listing) {
  const photo = Array.isArray(listing?.photos) ? listing.photos[0] : null;
  return photo?.src ? photo : null;
}

function listingPhotoMarkup(listing, { priority = false } = {}) {
  const photo = primaryListingPhoto(listing);
  if (!photo) {
    return `<div class="listing-photo-placeholder" role="img" aria-label="暂无公开实拍">${icon("image")}<span>暂无公开实拍</span></div>`;
  }
  const width = Math.max(1, Number(photo.width) || 1200);
  const height = Math.max(1, Number(photo.height) || 800);
  return `<picture class="listing-photo"><img data-listing-photo src="${escapeAttribute(photo.src)}" alt="${escapeAttribute(photo.alt || "房源公开实拍")}" width="${width}" height="${height}" ${priority ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" /></picture>`;
}

function minuteLabel(value) {
  if (value === null || value === undefined || value === "") return "待确认";
  const minutes = Number(value);
  return Number.isFinite(minutes) ? `${minutes} 分钟` : "待确认";
}

function candidateCard(candidate, index) {
  const listing = candidate.listing;
  const selectionLabel = String(candidate.selectionLabel || "")
    .replace("综合最合适", "首选")
    .replace("预算最轻", "省预算")
    .replace("居住条件最好", "住得好");
  return `<article class="candidate-card"><button data-action="open-candidate" data-id="${escapeAttribute(listing.id)}">
    <div class="candidate-photo">${listingPhotoMarkup(listing, { priority: index === 0 })}<span class="candidate-index">0${index + 1}</span><b class="candidate-label">${escapeText(selectionLabel)}</b></div>
    <div class="candidate-copy"><div><h2>${escapeText(listing.shortTitle)}</h2><strong>¥${formatInteger(candidate.agreedRent)}<small>/月</small></strong></div><p>${escapeText(listing.station)} · 步行 ${minuteLabel(listing.walkMinutes)} · 通勤 ${minuteLabel(listing.commuteMinutes)}</p><div class="candidate-tags"><span>${escapeText(listing.room.areaSqm)}㎡</span><span>${escapeText(listing.room.roommateCount)} 位室友</span><span>${escapeText(candidate.caveats[0] || "条件无冲突")}</span></div></div>
  </button></article>`;
}

function tenantCard(candidate, index) {
  const alias = candidate.displayAlias || candidate.tenant.alias;
  const mandate = candidate.tenant.mandate || {};
  const lease = mandate.leaseFlexible ? "租期灵活" : mandate.leaseMonths ? `${mandate.leaseMonths} 个月` : "租期待确认";
  const moveIn = mandate.moveInWindow?.from ? `${mandate.moveInWindow.from.slice(5)} 起` : "入住日待确认";
  return `<article class="tenant-card"><button data-action="open-candidate" data-id="${escapeAttribute(candidate.tenant.id)}"><span class="tenant-avatar">${escapeText(alias.slice(0, 1))}</span><div class="tenant-main"><div><h2>${escapeText(alias)}</h2><b>${escapeText(candidate.selectionLabel)}</b></div><p>${escapeText(candidate.tenant.occupation)} · ${escapeText(lease)} · ${escapeText(moveIn)}</p><strong>${candidate.agreedRent ? `¥${formatInteger(candidate.agreedRent)} / 月` : "价格待确认"}</strong></div>${icon("arrow")}</button></article>`;
}

function resultsScreen() {
  if (!state.task) return `<section class="plain-empty candidate-empty"><p>这里空空如也</p><span class="empty-create-hint"><svg class="empty-hint-arrow" viewBox="0 0 28 24" aria-hidden="true"><path d="M25 2C15 3 8 9 5 20"/><path d="m2 16 3 4 5-2"/></svg>点击这里新建任务</span></section>`;
  const allCandidates = state.task.kind === "renter" ? state.result?.candidates || [] : state.supplyResult?.candidates || [];
  const candidates = state.task.delivered ? allCandidates : allCandidates.slice(0, state.task.suitable);
  if (!state.task.delivered && !candidates.length) {
    const heading = state.task.kind === "renter" ? "正在找房" : "正在找租客";
    return `<section class="results-screen task-results-screen"><div class="candidate-searching" role="status" aria-live="polite">
      <h1>${heading}<span class="searching-dots" aria-hidden="true"><i></i><i></i><i></i></span></h1>
    </div></section>`;
  }
  const continuous = state.task.remoteId && state.task.status === "active";
  const searchState = continuous
    ? '<span class="inline-search-state">持续匹配中<span class="searching-dots" aria-hidden="true"><i></i><i></i><i></i></span></span>'
    : state.task.delivered ? "" : '<span class="inline-search-state">还在找<span class="searching-dots" aria-hidden="true"><i></i><i></i><i></i></span></span>';
  return `<section class="results-screen task-results-screen"><header><h1>${candidates.length} 个合适</h1>${searchState}</header>${candidates.length ? candidates.map((candidate, index) => state.task.kind === "renter" ? candidateCard(candidate, index) : tenantCard(candidate, index)).join("") : `<div class="empty-outcome"><b>这里空空如也</b></div>`}</section>`;
}

function insightsScreen() {
  const stats = visibleStats();
  const rate = stats.scanned ? Math.round((stats.suitable / stats.scanned) * 100) : 0;
  const weekly = Array.isArray(stats.dailyScanned) ? stats.dailyScanned.slice(-7) : [0, 0, 0, 0, 0, 0, 0];
  while (weekly.length < 7) weekly.unshift(0);
  const weeklyMax = Math.max(1, ...weekly);
  const weekLabels = ["六", "日", "一", "二", "三", "四", "五"];
  return `<section class="insights-screen"><div class="subpage-nav"><button data-action="back-profile" aria-label="返回我的">${icon("back")}</button></div>
    <section class="insight-hero"><span>加入天数</span><b>${stats.joinedDays}</b></section>
    <div class="metric-grid metric-grid-v2"><article><span>任务</span><b>${stats.tasksCreated}</b></article><article><span>已查看</span><b>${stats.scanned}</b></article><article><span>合适</span><b>${stats.suitable}</b></article><article><span>已确认</span><b>${stats.confirmed}</b></article></div>
    <section class="trend-card"><header><h2>近 7 天</h2><b>${weekly.reduce((sum, value) => sum + value, 0)}</b></header><div class="trend-bars" role="img" aria-label="近七天查看量：${weekly.join("、")}">${weekly.map((value, index) => `<span><i style="--bar:${Math.max(7, Math.round(value / weeklyMax * 100))}%"></i><em>${weekLabels[index]}</em></span>`).join("")}</div></section>
    <section class="funnel-card funnel-card-v2"><header><h2>匹配漏斗</h2><b>${rate}%</b></header><div class="funnel-layout"><svg class="funnel-svg" viewBox="0 0 150 150" role="img" aria-label="已查看 ${stats.scanned}，合适 ${stats.suitable}，双方确认 ${stats.confirmed}"><path d="M8 12h134l-21 42H29Z"/><path d="M31 62h88L103 99H47Z"/><path d="M49 107h52l-12 31H61Z"/></svg><dl><div><dt>已查看</dt><dd>${stats.scanned}</dd></div><div><dt>条件合适</dt><dd>${stats.suitable}</dd></div><div><dt>双方确认</dt><dd>${stats.confirmed}</dd></div></dl></div></section>
  </section>`;
}

function messagesScreen() {
  const notice = state.taskNotices[0] || demoRenewalTask;
  const noticeState = evaluateTaskLifecycle(notice.lifecycle, todayInShanghai());
  return `<section class="messages-screen">
    <header><h1>消息</h1><button data-action="open-settings" aria-label="消息设置">${icon("settings")}</button></header>
    <article class="expiry-message ${noticeState.renewalDue ? "is-due" : "is-renewed"}">
      <div class="message-icon">${icon("clock")}</div>
      <div><span>${noticeState.renewalDue ? `任务将于 ${formatShortDate(notice.lifecycle.expiresAt)} 到期` : `已续至 ${formatShortDate(notice.lifecycle.expiresAt)}`}</span><h2>${escapeHtml(notice.label)}</h2><p>${noticeState.daysRemaining} 天后停止接收新匹配</p></div>
      ${noticeState.renewalDue ? `<button data-action="renew-task" data-id="${escapeAttribute(notice.id)}">续 30 天</button>` : `<b class="renewed-mark">已续期</b>`}
    </article>
    <div class="message-list">
      <article><span class="message-avatar bear"><img src="./assets/bear-agent-anchor.png" alt="" width="48" height="48" /></span><div><b>小熊分身</b><p>静安寺附近新增 1 套合适房源</p></div><time>10:24</time></article>
      <article><span class="message-avatar confirm">${icon("check")}</span><div><b>双方确认</b><p>联系方式已解锁，可以约看房</p></div><time>昨天</time></article>
      <article><span class="message-avatar soft">${icon("shield")}</span><div><b>举报进度</b><p>房源已停止进入新的匹配</p></div><time>周一</time></article>
    </div>
  </section>`;
}

function profileScreen() {
  const isWorking = Boolean(state.task && !state.task.delivered);
  const agentLabel = state.task ? (state.task.delivered ? "本轮匹配已完成" : "持续匹配中") : "等待新任务";
  const stats = visibleStats();
  return `<section class="profile-screen">
    <header><img class="profile-avatar" src="./assets/user-avatar.png" alt="用户头像" width="84" height="84"/><div><h1>住哪儿用户</h1><p><span>个人房源</span><span>AI 分身已开启</span></p></div><button class="profile-settings" data-action="open-settings" aria-label="打开设置">${icon("settings")}</button></header>
    <div class="profile-stats"><span><b>${stats.tasksCreated}</b>任务</span><span><b>${stats.scanned}</b>已查看</span><span><b>${stats.suitable}</b>合适</span></div>
    <section class="agent-panel ${isWorking ? "is-working" : state.task ? "is-complete" : "is-idle"}">
      <div class="profile-agent-bear">${bearAgentMarkup({ id: "profile-bear", mode: isWorking ? "searching" : state.task ? "success" : "idle", compact: true, label: "我的小熊分身" })}</div>
      <div class="profile-agent-state"><span class="profile-agent-dot" aria-hidden="true"></span><p>${agentLabel}</p>${isWorking ? '<span class="profile-agent-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : ""}</div>
    </section>
    <section class="profile-menu"><button data-action="open-task-center">${icon("home")}<span>我的任务</span>${icon("arrow")}</button><button data-action="open-insights">${icon("chart")}<span>匹配数据</span>${icon("arrow")}</button><button data-action="switch-tab" data-value="messages">${icon("bell")}<span>通知与续期</span>${icon("arrow")}</button><button data-action="open-settings">${icon("settings")}<span>设置</span>${icon("arrow")}</button></section>
  </section>`;
}

function settingsToggle(key, title, detail) {
  const enabled = Boolean(state.settings[key]);
  return `<button class="settings-row" data-action="toggle-setting" data-value="${key}" aria-pressed="${enabled}"><span><b>${title}</b><em>${detail}</em></span><i class="switch-control" aria-hidden="true"></i></button>`;
}

function settingsScreen() {
  const contactSummary = state.contactProfile
    ? `${({ phone: "手机", wechat: "微信", email: "邮箱" })[state.contactProfile.type] || "联系方式"} · ${state.contactProfile.maskedValue}`
    : "未设置，确认条款前必须补充";
  return `<section class="settings-screen"><div class="subpage-nav settings-nav"><button data-action="back-profile" aria-label="返回我的">${icon("back")}</button><h1>设置</h1><span></span></div>
    <section class="settings-group"><h2>匹配与通知</h2>${settingsToggle("expiryReminder", "到期提醒", "任务到期前 5 天提醒续期")}${settingsToggle("candidateNotifications", "新候选通知", "出现新的合适房源或租客时通知")}${settingsToggle("privateNegotiation", "私密议价", "预算上限与出租底价仅由分身使用")}</section>
    <section class="settings-group"><h2>账户与数据</h2><button class="settings-link" data-action="open-contact-settings"><span><b>接收看房的联系方式</b><em>${escapeText(contactSummary)}</em></span>${icon("arrow")}</button><button class="settings-link" data-action="setting-info" data-value="city"><span><b>匹配城市</b><em>上海</em></span>${icon("arrow")}</button><button class="settings-link" data-action="setting-info" data-value="retention"><span><b>任务有效期</b><em>30 天，过期自动停止匹配</em></span>${icon("arrow")}</button><button class="settings-link" data-action="setting-info" data-value="privacy"><span><b>隐私与数据</b><em>每位用户的数据独立保存</em></span>${icon("arrow")}</button></section>
    <section class="settings-group"><h2>关于</h2><button class="settings-link" data-action="setting-info" data-value="about"><span><b>住哪儿</b><em>体验版 0.7 · 100×100 真实测试市场</em></span>${icon("arrow")}</button></section>
  </section>`;
}

function rootScreen() {
  if (state.page === "insights") return insightsScreen();
  if (state.page === "settings") return settingsScreen();
  if (state.tab === "results") return resultsScreen();
  if (state.tab === "messages") return messagesScreen();
  if (state.tab === "profile") return profileScreen();
  return matchScreen();
}

function activeCandidate() {
  const candidates = state.task?.kind === "supply" ? state.supplyResult?.candidates : state.result?.candidates;
  return candidates?.find((candidate) => (candidate.listing?.id || candidate.tenant?.id) === state.activeCandidateId) || null;
}

function clarificationOptionLabel(value) {
  return ({
    true: "是",
    false: "否",
    included: "已含在月租",
    actual_bill: "按账单另付",
    fixed_extra: "固定金额另付",
    unknown: "暂不确定",
    female: "女生",
    male: "男生",
    none: "没有室友"
  })[String(value)] || String(value);
}

function clarificationControl(question) {
  const spec = question.answerSpec || {};
  const type = spec.expectedAnswerType;
  const busy = state.clarificationSubmitting === question.id;
  if (type === "boolean" || type === "enum") {
    return `<div class="clarification-options">${(spec.options || []).map((option) => `<button data-action="answer-clarification-option" data-id="${escapeAttribute(question.id)}" data-value="${escapeAttribute(String(option))}" ${busy ? "disabled" : ""}>${escapeText(clarificationOptionLabel(option))}</button>`).join("")}</div>`;
  }
  if (type === "date_range") {
    return `<div class="clarification-entry date-range"><label>最早日期<input type="date" data-clarification-from="${escapeAttribute(question.id)}" /></label><label>最晚日期<input type="date" data-clarification-to="${escapeAttribute(question.id)}" /></label><button data-action="submit-clarification" data-id="${escapeAttribute(question.id)}" data-type="date_range" ${busy ? "disabled" : ""}>提交</button></div>`;
  }
  const inputType = type === "number" ? "number" : type === "date" ? "date" : "text";
  const bounds = type === "number" ? ` min="${escapeAttribute(spec.minimum)}" max="${escapeAttribute(spec.maximum)}"` : "";
  return `<div class="clarification-entry"><input type="${inputType}"${bounds} maxlength="${escapeAttribute(spec.maximumLength || 120)}" data-clarification-value="${escapeAttribute(question.id)}" aria-label="${escapeAttribute(question.question)}" /><button data-action="submit-clarification" data-id="${escapeAttribute(question.id)}" data-type="${escapeAttribute(type)}" ${busy ? "disabled" : ""}>提交</button></div>`;
}

function termsSummary(matchCase) {
  const terms = matchCase?.currentTerms?.publicTerms;
  if (!terms) return "";
  const rent = terms.rent ? `¥${formatInteger(terms.rent)}/月` : "月租待确认";
  const lease = terms.leaseMonths ? `${escapeText(terms.leaseMonths)} 个月` : "租期待确认";
  const moveIn = terms.moveInWindow?.from ? `${escapeText(terms.moveInWindow.from)} 起` : "入住日待确认";
  return `<div class="case-terms"><span>${rent}</span><span>${lease}</span><span>${moveIn}</span></div>`;
}

function matchClarificationSection(candidate) {
  if (!candidate.matchCaseId) return `<section class="case-progress-card"><h2>匹配进度</h2><p>演示候选不创建真实双边案例。</p></section>`;
  if (state.activeMatchCaseLoading) return `<section class="case-progress-card is-loading"><h2>正在读取双方进度</h2><p>只会显示你本人需要补充的内容。</p></section>`;
  if (state.activeMatchCaseError) return `<section class="case-progress-card is-error"><h2>暂时无法读取匹配进度</h2><p>${escapeText(state.activeMatchCaseError)}</p><button data-action="retry-match-case">重试</button></section>`;
  const matchCase = state.activeMatchCase;
  if (!matchCase) return "";
  const questions = matchCase.clarifications?.questions || [];
  const otherCount = Number(matchCase.clarifications?.otherPendingCount || 0);
  const otherCategories = matchCase.clarifications?.otherPendingCategories || [];
  const ready = ["terms_ready", "awaiting_confirmations", "mutually_confirmed"].includes(matchCase.status);
  const terminal = ["declined", "invalidated", "expired", "closed"].includes(matchCase.status);
  const statusText = terminal
    ? "匹配已失效"
    : matchCase.status === "mutually_confirmed"
      ? "双方已确认同一条款"
      : matchCase.myDecision === "confirmed"
        ? "你已确认，等待对方"
        : matchCase.otherDecision === "confirmed"
          ? "对方已确认，等待你"
          : matchCase.requiresReconfirmation
            ? "条款已变化，需要重新确认"
            : ready
              ? "待你确认"
              : questions.length
                ? "需要你补充信息"
                : otherCount
                  ? "正在等待对方补充"
                  : "正在重新核对条件";
  const badge = terminal ? "已失效" : matchCase.status === "mutually_confirmed" ? "已确认" : ready ? "待确认" : "核对中";
  return `<section class="case-progress-card ${ready ? "is-ready" : ""}">
    <header><div><span>双边匹配 · 条款 v${escapeText(matchCase.currentTerms?.version || "—")} · ${escapeText(matchCase.updatedAt?.replace("T", " ").slice(0, 16) || "")}</span><h2>${statusText}</h2></div><i>${badge}</i></header>
    ${termsSummary(matchCase)}
    ${matchCase.requiresReconfirmation ? `<div class="terms-change-summary" tabindex="-1" data-terms-change-summary><b>本次需要重新确认</b><p>${matchCase.termsChangeSummary?.length ? `${escapeText(matchCase.termsChangeSummary.join("、"))}发生变化。` : "任务输入已经更新，公开条款需重新确认。"}</p></div>` : ""}
    ${questions.map((question) => `<article class="match-question"><span>${escapeText(question.category)}</span><h3>${escapeText(question.question)}</h3>${question.answerSpec?.provider === "rule_fallback" ? "<p>AI 暂不可用，已切换规则问题</p>" : ""}${clarificationControl(question)}</article>`).join("")}
    ${otherCount ? `<p class="counterparty-pending">对方还有 ${otherCount} 项待补充${otherCategories.length ? `：${escapeText(otherCategories.join("、"))}` : ""}。未公开答案不会显示。</p>` : ""}
    ${state.clarificationSubmitting ? '<p class="recalculating" role="status">正在写入新版本并重新匹配…</p>' : ""}
  </section>`;
}

function matchDecisionActions(candidate) {
  if (!candidate.matchCaseId) return `<button class="primary-button" disabled>演示候选不进入双方确认</button>`;
  const matchCase = state.activeMatchCase;
  if (!matchCase || state.activeMatchCaseLoading) return `<button class="primary-button" disabled>正在读取确认状态</button>`;
  if (matchCase.status === "clarifying") return `<button class="primary-button" disabled>先完成匹配信息核对</button>`;
  if (["declined", "invalidated", "expired", "closed"].includes(matchCase.status)) return `<button class="primary-button" disabled>匹配已失效</button>`;
  if (matchCase.status === "mutually_confirmed") {
    if (state.revealedContact) {
      const typeLabel = ({ phone: "手机号", wechat: "微信号", email: "邮箱" })[state.revealedContact.type] || "联系方式";
      return `<section class="contact-card" aria-live="polite"><span>${typeLabel} · 仅本页临时显示</span><b>${escapeText(state.revealedContact.value)}</b><button data-action="hide-contact">隐藏</button></section>`;
    }
    if (matchCase.contactUnlocked) {
      return `<button class="primary-button" data-action="reveal-contact" ${state.contactLoading ? "disabled" : ""}>${state.contactLoading ? "正在安全读取…" : "点击查看对方联系方式"}</button>`;
    }
    return `<button class="primary-button" data-action="confirm-match">重新确认并开放联系方式</button>`;
  }
  if (matchCase.myDecision === "confirmed") return `<button class="primary-button" disabled>你已确认，等待对方</button><button class="report-link" data-action="decline-match">撤回并拒绝当前条款</button>`;
  return `<button class="primary-button" data-action="confirm-match">确认条款 v${escapeText(matchCase.currentTerms?.version)}</button><button class="report-link" data-action="decline-match">拒绝当前条款</button>`;
}

function listingShareText(candidate) {
  const listing = candidate.listing;
  return [
    `${listing.shortTitle}｜¥${formatInteger(candidate.agreedRent)}/月`,
    `${listing.station}，步行${minuteLabel(listing.walkMinutes)}，通勤${minuteLabel(listing.commuteMinutes)}`,
    `${listing.room.areaSqm}㎡，${listing.room.floor}/${listing.room.totalFloors} 层，${listing.room.roommateCount} 位室友`,
    `入住：${listing.availableFrom}`,
    candidate.reasons.slice(0, 2).join("；"),
    `来自“住哪儿”的匹配摘要`
  ].join("\n");
}

async function shareCandidate(candidate) {
  const text = listingShareText(candidate);
  if (!navigator.share) {
    await copyText(text, "房源摘要已复制");
    return;
  }

  // Owner routes are authenticated control surfaces, not public share links.
  const shareData = { title: candidate.listing.shortTitle, text };
  try {
    const photo = primaryListingPhoto(candidate.listing);
    if (!photo) throw new Error("listing has no public photo");
    const response = await fetch(photo.src, { credentials: "same-origin" });
    if (!response.ok) throw new Error("public listing photo is unavailable");
    const blob = await response.blob();
    const file = new File([blob], "房源照片.jpg", { type: blob.type || "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) shareData.files = [file];
  } catch {
    // The privacy-safe text remains shareable if the public image cannot be read.
  }

  try {
    await navigator.share(shareData);
    queueModalFocusRestore();
    state.sheet = null;
    showToast("已打开系统分享");
  } catch (error) {
    if (error?.name !== "AbortError") await copyText(text, "房源摘要已复制");
  }
}

async function loadActiveMatchCase() {
  const candidate = activeCandidate();
  const requestedId = candidate?.matchCaseId || null;
  state.activeMatchCase = null;
  state.revealedContact = null;
  state.activeMatchCaseError = null;
  state.activeMatchCaseLoading = Boolean(requestedId);
  render();
  if (!requestedId) return;
  try {
    const { matchCase } = await getMatchCase(requestedId);
    if (activeCandidate()?.matchCaseId !== requestedId) return;
    state.activeMatchCase = matchCase;
  } catch (error) {
    if (activeCandidate()?.matchCaseId !== requestedId) return;
    state.activeMatchCaseError = error.message || "匹配进度读取失败";
  } finally {
    if (activeCandidate()?.matchCaseId === requestedId) {
      state.activeMatchCaseLoading = false;
      render();
      if (state.activeMatchCase?.requiresReconfirmation) {
        requestAnimationFrame(() => app.querySelector("[data-terms-change-summary]")?.focus());
      }
    }
  }
}

async function submitClarification(clarificationId, answer) {
  const candidate = activeCandidate();
  if (!candidate?.matchCaseId || state.clarificationSubmitting) return;
  state.clarificationSubmitting = clarificationId;
  render();
  try {
    const response = await answerMatchClarification(candidate.matchCaseId, clarificationId, answer);
    state.activeMatchCase = response.matchCase;
    if (state.task?.remoteId) applyServerSnapshot(await getServerTask(state.task.remoteId), { renderNow: false });
    state.clarificationSubmitting = null;
    if (!activeCandidate()) {
      state.page = "root";
      state.tab = "results";
      showToast("新信息与对方条件冲突，已移出候选");
      return;
    }
    showToast(response.answer?.idempotent ? "这个答案已经保存" : "已保存，匹配结果已重新计算");
  } catch (error) {
    state.clarificationSubmitting = null;
    showToast(error.message || "回答提交失败");
  }
}

function detailContactAction(realCase) {
  if (!realCase) return `<button disabled>${icon("contact")}<span>演示不开放</span></button>`;
  if (state.activeMatchCase?.contactUnlocked) {
    return `<button data-action="reveal-contact" ${state.contactLoading ? "disabled" : ""}>${icon("contact")}<span>${state.revealedContact ? "已临时显示" : state.contactLoading ? "安全读取中" : "查看联系方式"}</span></button>`;
  }
  return `<button disabled>${icon("contact")}<span>确认后开放</span></button>`;
}

function candidateDetail() {
  const candidate = activeCandidate();
  if (!candidate) return resultsScreen();
  if (state.task?.kind === "supply") return tenantDetail(candidate);
  const listing = candidate.listing;
  const realCase = Boolean(candidate.matchCaseId);
  const bodyMarkup = `
      <div class="detail-actions"><button data-action="copy-listing">${icon("copy")}<span>复制摘要</span></button><button data-action="open-share">${icon("share")}<span>转发房源</span></button>${detailContactAction(realCase)}</div>
      <section class="fit-card"><header><h2>为什么合适</h2><b>${escapeText(candidate.score)}%</b></header>${candidate.reasons.map((item) => `<p>${escapeText(item)}</p>`).join("")}</section>
      <section class="notice-card"><h2>需要留意</h2>${candidate.caveats.map((item) => `<p>${escapeText(item)}</p>`).join("") || "<p>仍需本人现场确认</p>"}</section>
      <section class="source-card"><h2>资料来源</h2>${candidate.provenance.map((item) => `<div><span>${escapeText(item.label)}</span><b>${escapeText(item.value)}</b><em>${escapeText(item.source)}</em></div>`).join("")}</section>
      <section class="agent-dialogue-card"><h2>两个分身怎么谈</h2>${candidate.negotiation.publicEvents.map((event) => {
        const actor = event.actor === "找房 AI" ? "找房分身" : event.actor === "出租 AI" ? "房源分身" : "双方分身";
        const side = event.actor === "出租 AI" ? "is-supply" : event.actor === "双方 AI" ? "is-both" : "is-renter";
        return `<div class="agent-dialogue-row ${side}"><span>${actor}</span><div><b>${escapeText(event.title)}</b><p>${escapeText(event.detail)}</p></div></div>`;
      }).join("")}</section>
      ${matchClarificationSection(candidate)}
      ${matchDecisionActions(candidate)}<button class="report-link" data-action="open-report">举报房源</button>
  `;
  return renderMatchDetail({
    selectionLabel: candidate.selectionLabel,
    title: listing.shortTitle,
    subtitle: `${listing.station} · 步行${minuteLabel(listing.walkMinutes)}`,
    priceLabel: `¥${formatInteger(candidate.agreedRent)} /月`,
    facts: [
      `${listing.room.areaSqm}㎡`,
      `${listing.room.floor}/${listing.room.totalFloors} 层`,
      `${listing.room.roommateCount} 位室友`
    ],
    mediaMarkup: `<div class="detail-photo">${listingPhotoMarkup(listing, { priority: true })}</div>`,
    bodyMarkup,
    showShare: true,
    backIconMarkup: icon("back"),
    shareIconMarkup: icon("share")
  });
}

function tenantDetail(candidate) {
  const tenant = candidate.tenant;
  const alias = candidate.displayAlias || tenant.alias;
  const mandate = tenant.mandate || {};
  const bodyMarkup = `
      <section class="fit-card"><header><h2>为什么合适</h2><b>${escapeText(candidate.score)}%</b></header>${candidate.reasons.map((item) => `<p>${escapeText(item)}</p>`).join("")}</section>
      <section class="notice-card"><h2>需要留意</h2>${candidate.caveats.map((item) => `<p>${escapeText(item)}</p>`).join("") || "<p>仍需双方完成条款确认</p>"}</section>
      ${matchClarificationSection(candidate)}
      ${matchDecisionActions(candidate)}
  `;
  return renderMatchDetail({
    selectionLabel: candidate.selectionLabel,
    facts: [
      mandate.leaseFlexible ? "租期灵活" : `${mandate.leaseMonths} 个月`,
      mandate.moveInWindow?.from || "入住日待定",
      `最长通勤 ${mandate.maxCommuteMinutes || "—"} 分钟`
    ],
    mediaMarkup: `<div class="tenant-detail-hero"><span class="tenant-avatar">${escapeText(alias.slice(0, 1))}</span><h1>${escapeText(alias)}</h1><p>${escapeText(tenant.occupation)}</p></div>`,
    bodyMarkup,
    variant: "tenant",
    backIconMarkup: icon("back")
  });
}

function createSheet() {
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>新建任务</h2><button data-action="close-sheet" aria-label="关闭">${icon("close")}</button></header><button class="intent-card renter" data-action="create-renter"><span>${icon("location")}</span><div><b>我要找房</b><p>发布一条找房需求</p></div>${icon("arrow")}</button><button class="intent-card supply" data-action="create-supply"><span>${icon("home")}</span><div><b>我要出租</b><p>房东直租或个人转租</p></div>${icon("arrow")}</button></section></div>`;
}

const mapLocations = [
  ["静安寺", 17, 22], ["江苏路", 48, 18], ["南京西路", 76, 27], ["武宁路", 28, 43],
  ["中山公园", 62, 45], ["人民广场", 84, 53], ["徐家汇", 15, 68], ["漕河泾", 40, 76],
  ["世纪大道", 71, 73], ["张江", 88, 84]
];

function locationSuggestionMarkup(searchText) {
  const query = String(searchText || "").trim().toLowerCase();
  if (!query) return "";
  return marketplaceAreas
    .filter((item) => `${item.location}${item.station}${item.district}`.toLowerCase().includes(query))
    .slice(0, 5)
    .map((item) => `<button data-action="toggle-location" data-value="${escapeAttribute(item.location)}"><span><b>${escapeText(item.location)}</b><em>${escapeText(item.station)} · ${escapeText(item.district)}</em></span>${icon("plus")}</button>`)
    .join("");
}

function locationSheet() {
  return `<div class="map-modal"><section class="map-sheet"><header><button data-action="close-sheet" aria-label="返回">${icon("back")}</button><h2>选择想住的区域</h2><button data-action="confirm-location">完成</button></header><div class="map-search"><label>${icon("search")}<input name="location-query" autocomplete="off" aria-label="搜索小区、地铁站或商圈" data-input="location-search" value="${escapeAttribute(state.locationSearch)}" placeholder="搜索小区、地铁站或商圈" /></label><button data-action="locate-me" aria-label="使用当前位置">${icon("location")}<span>${state.locateState === "locating" ? "定位中" : state.locateState === "done" ? "已定位" : "定位"}</span></button></div><div class="location-suggestions">${locationSuggestionMarkup(state.locationSearch)}</div><div class="map-canvas"><i class="river"></i><i class="road road-a"></i><i class="road road-b"></i><i class="road road-c"></i>${mapLocations.map(([name, x, y]) => `<button class="map-pin" style="--x:${x}%;--y:${y}%" data-action="toggle-location" data-value="${escapeAttribute(name)}" aria-pressed="${state.selectedLocations.includes(name)}"><span></span>${escapeText(name)}</button>`).join("")}<div class="current-pulse ${state.locateState === "done" ? "show" : ""}"></div></div><div class="map-controls"><div class="selected-areas">${state.selectedLocations.map((name) => `<button data-action="toggle-location" data-value="${escapeAttribute(name)}">${escapeText(name)} ${icon("close")}</button>`).join("") || "<b>点地图或搜索添加区域</b>"}</div><div class="radius-control"><span>区域半径</span>${["1", "2", "3"].map((value) => `<button data-action="set-radius" data-value="${value}" aria-pressed="${state.locationRadius === value}">${value} km</button>`).join("")}</div><button class="primary-button" data-action="confirm-location">使用这些区域</button></div></section></div>`;
}

function photoSheet() {
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet compact-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>添加房源照片</h2><button data-action="close-sheet" aria-label="关闭">${icon("close")}</button></header><button class="source-option" data-action="trigger-camera">${icon("camera")}<span>拍照</span>${icon("arrow")}</button><button class="source-option" data-action="trigger-library">${icon("image")}<span>从相册选择</span>${icon("arrow")}</button><input id="camera-input" name="camera-photo" hidden type="file" accept="image/*" capture="environment" data-file="camera"/><input id="library-input" name="library-photos" hidden type="file" accept="image/*" multiple data-file="library"/></section></div>`;
}

function shareSheet() {
  const candidate = activeCandidate();
  if (!candidate) return "";
  const contactAction = `<button class="source-option" disabled>${icon("contact")}<span>${candidate.matchCaseId ? "联系方式不会进入分享内容" : "演示候选不开放联系方式"}</span>${icon("lock")}</button>`;
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet compact-sheet share-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>转发房源</h2><button data-action="close-sheet" aria-label="关闭">${icon("close")}</button></header><div class="share-preview"><div class="share-preview-photo">${listingPhotoMarkup(candidate.listing)}</div><div><b>${escapeText(candidate.listing.shortTitle)}</b><span>¥${formatInteger(candidate.agreedRent)}/月</span></div></div><button class="source-option" data-action="share-listing">${icon("share")}<span>分享房源卡片</span>${icon("arrow")}</button><button class="source-option" data-action="copy-listing">${icon("copy")}<span>复制文字摘要</span>${icon("arrow")}</button>${contactAction}</section></div>`;
}

function labSheet() {
  const passed = state.regression?.filter((item) => item.passed).length || 0;
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet lab-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>案例测试台</h2><button data-action="close-sheet" aria-label="关闭">${icon("close")}</button></header><div class="scenario-list">${labScenarios.map((scenario) => `<button data-action="load-scenario" data-value="${scenario.id}"><span><b>${scenario.name}</b><p>${scenario.description}</p></span>${icon("arrow")}</button>`).join("")}</div><button class="secondary-button" data-action="run-regression">${state.regression ? `${passed}/${state.regression.length} 项规则通过` : "运行全部规则检查"}</button></section></div>`;
}

function reportSheet() {
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>举报房源</h2><button data-action="close-sheet" aria-label="关闭">${icon("close")}</button></header>${[["broker_or_fee", "冒充个人或索取费用"], ["mismatch", "现场与信息不符"], ["stolen_photo", "盗用他人图片"], ["unavailable", "房源已不可租"]].map(([value, label]) => `<button class="report-option" data-action="set-report-type" data-value="${value}" aria-pressed="${state.reportType === value}">${label}</button>`).join("")}<label class="consent-row"><input type="checkbox" name="report-evidence" data-action="toggle-report-evidence" ${state.reportHasEvidence ? "checked" : ""}/><span>附上站内收费对话</span></label><button class="danger-button" data-action="submit-report">提交举报</button></section></div>`;
}

function reportResultSheet() {
  const confirmed = state.reportResult?.status === "identity_banned";
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>处理结果</h2><button data-action="close-sheet" aria-label="关闭">${icon("close")}</button></header><div class="report-result"><span>${icon("shield")}</span><h3>${confirmed ? "账号及关联房源已冻结" : "房源已退出新匹配"}</h3><p>${escapeText(state.reportResult?.finalAction)}</p></div><button class="secondary-button" data-action="close-sheet">完成</button></section></div>`;
}

function contactSheet() {
  return `<div class="modal-scrim" data-action="close-sheet-from-scrim"><section class="bottom-sheet compact-sheet contact-settings-sheet" data-sheet-body><div class="sheet-handle"></div><header><h2>设置联系方式</h2><button data-action="close-sheet" aria-label="关闭">${icon("close")}</button></header><p>只在双方确认同一版条款后，通过服务端临时授权给对方。</p><label><span>类型</span><select data-contact-type><option value="wechat" ${state.contactProfile?.type === "wechat" ? "selected" : ""}>微信</option><option value="phone" ${state.contactProfile?.type === "phone" ? "selected" : ""}>手机</option><option value="email" ${state.contactProfile?.type === "email" ? "selected" : ""}>邮箱</option></select></label><label><span>新联系方式</span><input data-input="contact-value" data-contact-value autocomplete="off" maxlength="254" value="${escapeAttribute(state.contactDraft || "")}" placeholder="输入后将加密保存" /></label>${fieldErrorMarkup("contact")}${state.contactProfile ? `<small>当前已保存：${escapeText(state.contactProfile.maskedValue)}</small>` : ""}<button class="primary-button" data-action="save-contact" ${state.contactSubmitting ? "disabled" : ""}>${state.contactSubmitting ? "正在加密保存…" : "加密保存"}</button></section></div>`;
}

function activeSheet() {
  if (state.sheet === "create") return createSheet();
  if (state.sheet === "location") return locationSheet();
  if (state.sheet === "photo") return photoSheet();
  if (state.sheet === "share") return shareSheet();
  if (state.sheet === "lab") return labSheet();
  if (state.sheet === "report") return reportSheet();
  if (state.sheet === "report-result") return reportResultSheet();
  if (state.sheet === "contact") return contactSheet();
  return "";
}

function connectionBar() {
  const { phase, message, lastSuccessAt } = state.connection;
  const labels = {
    connecting: "正在连接",
    online: "连接正常",
    degraded: "安全模式",
    offline: "连接中断"
  };
  const lastSuccess = lastSuccessAt
    ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(lastSuccessAt))
    : "尚未连接";
  const detail = phase === "online" ? `最近同步 ${lastSuccess}` : message;
  return `<aside class="connection-bar is-${phase}" data-connection-phase="${phase}" aria-label="服务连接状态"><span class="connection-dot" aria-hidden="true"></span><div><b>${labels[phase]}</b><small>${escapeText(detail)}</small></div>${phase === "offline" ? '<button data-action="retry-connection">重试</button>' : ""}</aside>`;
}

function decorateFocusKeys() {
  const used = new Map();
  for (const element of app.querySelectorAll("button, a[href], input, select, textarea, [tabindex]")) {
    if (element.dataset.focusKey) continue;
    const base = element.id
      ? `id:${element.id}`
      : element.dataset.input
        ? `input:${element.dataset.input}`
        : element.dataset.action
          ? `action:${element.dataset.action}:${element.dataset.key || ""}:${element.dataset.value || element.dataset.id || ""}`
          : element.name
            ? `name:${element.name}`
            : `control:${element.tagName.toLowerCase()}`;
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    element.dataset.focusKey = count ? `${base}:${count}` : base;
  }
}

function applyFieldErrorAttributes() {
  const controls = {
    location: ['[data-action="open-location"]'],
    budget: ['[data-input="budget-min"]', '[data-input="budget-max"]'],
    moveIn: ['[data-input="move-in-from"]', '[data-input="move-in-to"]'],
    commute: ['[data-input="commute-range"]'],
    lease: ['[data-action="set-answer"][data-key="leaseMonths"]'],
    contact: ['[data-contact-value]']
  };
  for (const [fieldKey, selectors] of Object.entries(controls)) {
    const message = state.fieldErrors[fieldKey];
    for (const selector of selectors) {
      for (const control of app.querySelectorAll(selector)) {
        control.setAttribute("aria-invalid", message ? "true" : "false");
        if (message) control.setAttribute("aria-describedby", `field-error-${fieldKey}`);
        else control.removeAttribute("aria-describedby");
      }
    }
  }
}

function focusFirstInvalidField() {
  const order = ["location", "budget", "moveIn", "commute", "lease", "contact"];
  const selector = {
    location: '[data-action="open-location"]',
    budget: '[data-input="budget-min"]',
    moveIn: '[data-input="move-in-from"]',
    commute: '[data-input="commute-range"]',
    lease: '[data-action="set-answer"][data-key="leaseMonths"]',
    contact: "[data-contact-value]"
  }[order.find((key) => state.fieldErrors[key])];
  app.querySelector(selector)?.focus({ preventScroll: false });
}

function prepareActiveDialog(focusKeyBeforeRender, sheetBeforeRender) {
  const modal = app.querySelector(".modal-scrim > .bottom-sheet, .map-modal > .map-sheet");
  if (!modal) return;
  const title = modal.querySelector("h2");
  if (title) {
    title.id = `dialog-title-${state.sheet}`;
    modal.setAttribute("aria-labelledby", title.id);
  }
  const sameDialog = state.sheet === sheetBeforeRender;
  const restoredControl = sameDialog
    ? [...modal.querySelectorAll("[data-focus-key]")].find((element) => element.dataset.focusKey === focusKeyBeforeRender)
    : null;
  const initialFocus = restoredControl
    || (state.sheet === "location" ? modal.querySelector('[data-input="location-search"]') : null)
    || modal.querySelector("button, input, select, textarea")
    || modal;
  focusManager.openModal({
    modal,
    trigger: modalTriggerFocusKey ? { dataset: { focusKey: modalTriggerFocusKey } } : null,
    initialFocus,
    background: [app.querySelector("#app-main"), app.querySelector(".tab-dock")]
  });
}

function rememberModalTrigger(trigger) {
  modalTriggerFocusKey = focusManager.elementFocusKey(trigger);
}

function queueModalFocusRestore() {
  pendingFocusRestoreKey = modalTriggerFocusKey;
  modalTriggerFocusKey = null;
}

function closeActiveSheet() {
  queueModalFocusRestore();
  state.sheet = null;
  state.contactSubmitting = false;
  render();
}

function render() {
  syncExpiredTask();
  document.body.dataset.motion = state.motion;
  const previousScrollTop = app.querySelector("#app-main")?.scrollTop || 0;
  const focusKeyBeforeRender = focusManager.elementFocusKey(document.activeElement);
  const sheetBeforeRender = lastRenderedSheet;
  const immersive = Boolean(state.flow) || state.page !== "root";
  const viewKey = [state.tab, state.flow, state.renterStage, state.supplyStage, state.page, state.activeCandidateId, state.sheet].join(":");
  const content = state.flow === "renter"
    ? renterFlow()
    : state.flow === "supply"
      ? supplyFlow()
      : state.page === "candidate"
        ? candidateDetail()
        : state.page === "tasks"
          ? renderTaskCenter({
            tasks: state.tasks,
            activeTaskId: state.activeTaskId,
            loading: state.taskCenterLoading,
            error: state.taskCenterError,
            notice: state.routeNotice
          })
          : rootScreen();
  const demoBanner = state.demoBanner
    ? '<div class="demo-mode-banner" role="status">演示模式 · 当前候选包含测试语料</div>'
    : "";
  app.innerHTML = `<div class="device"><div class="app-shell">${statusBar()}${demoBanner}${connectionBar()}<main id="app-main" class="screen-scroll ${immersive ? "immersive" : ""}" tabindex="-1">${content}</main>${immersive ? "" : tabBar()}${activeSheet()}${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ""}</div></div>`;
  decorateFocusKeys();
  applyFieldErrorAttributes();
  prepareActiveDialog(focusKeyBeforeRender, sheetBeforeRender);
  const main = app.querySelector("#app-main");
  if (main) main.scrollTop = viewKey === lastViewKey ? previousScrollTop : 0;
  lastViewKey = viewKey;
  lastRenderedSheet = state.sheet;
  if (!state.sheet && pendingFocusRestoreKey) {
    const restoreKey = pendingFocusRestoreKey;
    pendingFocusRestoreKey = null;
    window.requestAnimationFrame(() => focusManager.restoreFocus(restoreKey, app));
  }
  if (pendingInvalidFocus) {
    pendingInvalidFocus = false;
    window.requestAnimationFrame(focusFirstInvalidField);
  }
  void mountBearAgents(app);
  persistProductState();
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

async function beginIntake() {
  if (!state.draftText.trim() && !state.selectedLocations.length) {
    showToast("先说说需求，或在地图上选区域");
    return;
  }
  state.intakeLoading = true;
  render();
  try {
    if (state.draftText.trim()) {
      const response = await parseRenterWithServer(state.draftText, todayInShanghai());
      state.parsedDemand = response.parsed;
      state.intakeProvider = response.provider;
      if (response.warning) markConnectionDegraded(response.warning);
      else markConnectionSuccess();
    } else {
      state.parsedDemand = parseDemandText(state.selectedLocations.join("、"), todayInShanghai());
      state.intakeProvider = "deterministic";
      markConnectionSuccess();
    }
  } catch (error) {
    state.parsedDemand = parseDemandText(state.draftText, todayInShanghai());
    state.intakeProvider = "deterministic";
    markConnectionDegraded(error.message || "AI 暂时不可用，已使用确定性解析");
  }
  state.intakeLoading = false;
  state.answers = seedAnswersFromParsed(state.parsedDemand, defaultAnswers());
  state.renterFieldStates = proposedFieldStates(state.answers);
  state.renterInputVersion = 1;
  if (state.parsedDemand?.fields?.locations?.length) {
    state.selectedLocations = [...state.parsedDemand.fields.locations];
  }
  state.consent = false;
  state.flow = "renter";
  state.renterStage = "clarify";
  render();
}

async function beginSupplyIntake() {
  if (!state.supplyText.trim()) {
    showToast("先说说房源情况");
    return;
  }
  state.intakeLoading = true;
  render();
  try {
    const response = await parseSupplyWithServer(state.supplyText, todayInShanghai());
    state.parsedSupply = response.parsed;
    state.intakeProvider = response.provider;
    if (response.warning) markConnectionDegraded(response.warning);
    else markConnectionSuccess();
  } catch (error) {
    state.parsedSupply = parseSupplyText(state.supplyText, todayInShanghai());
    state.intakeProvider = "deterministic";
    markConnectionDegraded(error.message || "AI 暂时不可用，已使用确定性解析");
  }
  state.intakeLoading = false;
  seedSupplyFromParsed(state.parsedSupply);
  state.supplyFieldStates = proposedFieldStates(state.supplyDraft);
  state.supplyInputVersion = 1;
  state.supplyPledge = false;
  state.supplyValidation = null;
  state.flow = "supply";
  state.supplyStage = "draft";
  render();
}

function clearMatchTimers() {
  matchTimers.forEach((timer) => clearTimeout(timer));
  matchTimers = [];
}

function clearTaskPolling() {
  if (taskPollTimer) window.clearInterval(taskPollTimer);
  taskPollTimer = null;
}

function summarizeTaskMatches(task, matches = []) {
  const activeCases = matches.filter((matchCase) => !["declined", "invalidated", "expired", "closed"].includes(matchCase.status));
  return {
    ...task,
    candidateCount: task.suitable,
    clarificationCount: activeCases.reduce((sum, matchCase) => sum + (matchCase.clarifications?.questions?.length || 0), 0),
    myConfirmationCount: activeCases.filter((matchCase) => matchCase.currentTerms && matchCase.myDecision === "pending").length,
    otherConfirmationCount: activeCases.filter((matchCase) => matchCase.myDecision === "confirmed" && matchCase.otherDecision !== "confirmed").length
  };
}

async function refreshTaskList({ renderNow = false } = {}) {
  const { tasks } = await listServerTasks();
  const summaries = await Promise.all(tasks.map(async (task) => {
    try {
      const response = await listTaskMatches(task.id);
      return summarizeTaskMatches(task, response.matches);
    } catch {
      return summarizeTaskMatches(task);
    }
  }));
  state.tasks = summaries;
  markConnectionSuccess();
  if (renderNow) render();
  return summaries;
}

function applyServerSnapshot(snapshot, { renderNow = true } = {}) {
  if (!snapshot?.task) return;
  const previous = state.task?.id === snapshot.task.id ? state.task : null;
  const visualChanged = !previous ||
    previous.status !== snapshot.task.status ||
    previous.scanned !== snapshot.task.scanned ||
    previous.suitable !== snapshot.task.suitable ||
    previous.candidateVersion !== snapshot.task.candidateVersion;
  state.task = {
    ...(previous || {}),
    id: snapshot.task.id,
    remoteId: snapshot.task.id,
    kind: snapshot.task.kind,
    label: snapshot.task.label,
    status: snapshot.task.status,
    phaseIndex: 3,
    scanned: snapshot.task.scanned,
    suitable: snapshot.task.suitable,
    total: snapshot.task.scanned,
    finalSuitable: snapshot.task.suitable,
    delivered: true,
    statsCommitted: previous?.statsCommitted || false,
    events: snapshot.events || [],
    candidateVersion: snapshot.task.candidateVersion,
    lastMatchAt: snapshot.task.lastMatchAt,
    lifecycle: {
      createdAt: snapshot.task.createdAt?.slice(0, 10) || todayInShanghai(),
      expiresAt: snapshot.task.expiresAt?.slice(0, 10) || addDaysToIso(todayInShanghai(), 30),
      renewalLeadDays: 5,
      retentionDays: 30
    }
  };
  state.activeTaskId = snapshot.task.id;
  const summaryIndex = state.tasks.findIndex((task) => task.id === snapshot.task.id);
  const currentSummary = summarizeTaskMatches(snapshot.task, []);
  if (summaryIndex >= 0) {
    const previousSummary = state.tasks[summaryIndex];
    state.tasks[summaryIndex] = {
      ...currentSummary,
      clarificationCount: previousSummary.clarificationCount,
      myConfirmationCount: previousSummary.myConfirmationCount,
      otherConfirmationCount: previousSummary.otherConfirmationCount
    };
  }
  else state.tasks.unshift(currentSummary);
  const result = { scanned: snapshot.task.scanned, candidates: snapshot.candidates || [], audit: snapshot.events || [] };
  if (snapshot.task.kind === "renter") state.result = result;
  else state.supplyResult = result;
  markConnectionSuccess();
  if (renderNow && visualChanged) render();
}

function startTaskPolling(taskId) {
  clearTaskPolling();
  let polling = false;
  const poll = async () => {
    if (polling || state.activeTaskId !== taskId) return;
    polling = true;
    try {
      applyServerSnapshot(await getServerTask(taskId));
      if (state.page === "candidate" && state.activeMatchCase?.id) {
        const previousCase = state.activeMatchCase;
        const { matchCase } = await getMatchCase(previousCase.id);
        state.activeMatchCase = matchCase;
        if (!matchCase.contactUnlocked) state.revealedContact = null;
        if (previousCase.status !== matchCase.status
          || previousCase.contactUnlocked !== matchCase.contactUnlocked
          || previousCase.updatedAt !== matchCase.updatedAt) render();
      }
    } catch (error) {
      markConnectionOffline(error);
      state.revealedContact = null;
      render();
    } finally {
      polling = false;
    }
  };
  taskPollTimer = window.setInterval(poll, 3000);
}

async function initializeServerState() {
  recoveryExpected ||= ["offline", "degraded"].includes(state.connection.phase);
  state.connection = { ...state.connection, phase: "connecting", message: "正在连接服务" };
  render();
  try {
    const health = await getServerHealth();
    state.marketMode = health.marketMode || "real";
    state.demoBanner = Boolean(health.demoBanner);
    await ensureServerSession();
    markConnectionSuccess();
    const profileContact = await getProfileContact();
    state.contactProfile = profileContact.contact;
    const tasks = await refreshTaskList();
    const route = parseRoute(location.href);
    if (route.name === "invalid") {
      await showTaskCenter("这个链接无效，已返回你的任务列表。", { replace: true });
      return;
    }
    if (route.name === "task-center") {
      state.page = "tasks";
      clearTaskPolling();
      render();
      return;
    }
    if (["task", "match"].includes(route.name)) {
      const owned = tasks.some((task) => task.id === route.taskId);
      if (!owned) {
        await showTaskCenter("该任务不存在，或不属于当前账号。", { replace: true });
        return;
      }
      await selectServerTask(route.taskId, {
        matchCaseId: route.name === "match" ? route.matchCaseId : null,
        navigate: false
      });
      return;
    }
    const selectedTask = tasks.find((task) => task.id === state.activeTaskId) ||
      tasks.find((task) => task.status === "active") || tasks[0];
    if (selectedTask) {
      await selectServerTask(selectedTask.id, { navigate: false });
    } else {
      // The previous prototype persisted a local demo task. Once the server is
      // authoritative, never let that stale local object masquerade as a live
      // task when this account has no active server task.
      state.task = null;
      state.result = null;
      state.supplyResult = null;
      state.activeCandidateId = null;
      state.activeMatchCase = null;
      state.activeMatchCaseLoading = false;
      state.activeMatchCaseError = null;
      render();
    }
  } catch (error) {
    markConnectionOffline(error);
    render();
  }
}

function candidateIdentifier(candidate, kind = state.task?.kind) {
  return kind === "supply" ? candidate?.tenant?.id : candidate?.listing?.id;
}

async function selectServerTask(taskId, { matchCaseId = null, navigate = true, replace = false } = {}) {
  const ownedTask = state.tasks.find((task) => task.id === taskId);
  if (!ownedTask) {
    await showTaskCenter("该任务不存在，或不属于当前账号。", { replace: true });
    return false;
  }
  clearTaskPolling();
  state.taskCenterError = null;
  state.routeNotice = null;
  state.activeCandidateId = null;
  state.activeMatchCase = null;
  state.revealedContact = null;
  try {
    const snapshot = await getServerTask(taskId);
    applyServerSnapshot(snapshot, { renderNow: false });
    state.page = "root";
    state.tab = "results";
    if (matchCaseId) {
      const candidate = (snapshot.candidates || []).find((item) => item.matchCaseId === matchCaseId);
      if (!candidate) {
        await showTaskCenter("该匹配结果已失效，已返回你的任务列表。", { replace: true });
        return false;
      }
      state.activeCandidateId = candidateIdentifier(candidate, snapshot.task.kind);
      state.page = "candidate";
      await loadActiveMatchCase();
    } else {
      render();
    }
    if (snapshot.task.status === "active") startTaskPolling(taskId);
    if (navigate) {
      const route = matchCaseId
        ? { name: "match", taskId, matchCaseId }
        : { name: "task", taskId };
      if (replace) replaceRoute(route); else pushRoute(route);
    }
    return true;
  } catch (error) {
    if (error.status !== 404) markConnectionOffline(error);
    await showTaskCenter(error.status === 404 ? "该任务不存在，或不属于当前账号。" : error.message, { replace: true });
    return false;
  }
}

async function showTaskCenter(notice = "", { replace = false } = {}) {
  clearTaskPolling();
  state.page = "tasks";
  state.flow = null;
  state.sheet = null;
  state.routeNotice = notice || null;
  state.taskCenterLoading = true;
  state.taskCenterError = null;
  render();
  try {
    await refreshTaskList();
  } catch (error) {
    state.taskCenterError = error.message || "任务列表读取失败";
    markConnectionOffline(error);
  } finally {
    state.taskCenterLoading = false;
    render();
  }
  if (replace) replaceRoute({ name: "task-center" });
  else if (parseRoute(location.href).name !== "task-center") pushRoute({ name: "task-center" });
}

async function restoreRouteFromLocation() {
  const route = parseRoute(location.href);
  if (route.name === "home") {
    state.page = "root";
    state.flow = null;
    state.activeCandidateId = null;
    state.activeMatchCase = null;
    state.activeMatchCaseError = null;
    state.revealedContact = null;
    render();
    return;
  }
  if (route.name === "task-center") {
    await showTaskCenter();
    return;
  }
  if (["task", "match"].includes(route.name)) {
    await selectServerTask(route.taskId, {
      matchCaseId: route.name === "match" ? route.matchCaseId : null,
      navigate: false
    });
    return;
  }
  await showTaskCenter("这个链接无效，已返回你的任务列表。", { replace: true });
}

function buildTask(kind, total, suitable, label) {
  return {
    id: `${kind}-${crypto.randomUUID()}`,
    kind,
    label,
    phaseIndex: 0,
    scanned: 0,
    suitable: 0,
    total,
    finalSuitable: suitable,
    delivered: false,
    statsCommitted: false,
    events: [],
    lifecycle: createTaskLifecycle(todayInShanghai())
  };
}

function startMatching(kind, remoteTask = null) {
  clearMatchTimers();
  // A user can keep more than one live mandate. Stop polling the previous one
  // before switching the home/results view to the task that was just published.
  clearTaskPolling();
  const result = kind === "renter" ? state.result : state.supplyResult;
  const label = kind === "renter" ? mandateFromAnswers().locations.slice(0, 2).join(" / ") : `${state.supplyDraft.location}次卧`;
  state.task = buildTask(kind, result.scanned, result.candidates.length, label);
  if (remoteTask) {
    state.task.id = remoteTask.id;
    state.task.remoteId = remoteTask.id;
    state.task.status = remoteTask.status;
    state.task.candidateVersion = remoteTask.candidateVersion;
    state.task.lastMatchAt = remoteTask.lastMatchAt;
    state.activeTaskId = remoteTask.id;
    state.tasks = [summarizeTaskMatches(remoteTask), ...state.tasks.filter((task) => task.id !== remoteTask.id)];
    replaceRoute({ name: "task", taskId: remoteTask.id });
  }
  state.stats.tasksCreated += 1;
  state.tab = "match";
  state.page = "root";
  state.flow = null;
  // The server response is the completed first run. Do not invent progress
  // percentages or a theatrical delay; ongoing work is represented by polling.
  state.task.phaseIndex = 3;
  state.task.scanned = result.scanned;
  state.task.suitable = result.candidates.length;
  state.task.delivered = true;
  commitCompletedTask(result);
  if (state.task.remoteId) startTaskPolling(state.task.remoteId);
  state.tab = "results";
  render();
}

function resetAll() {
  clearMatchTimers();
  clearTaskPolling();
  state = {
    ...state,
    tab: "match",
    flow: null,
    page: "root",
    sheet: null,
    renterStage: "input",
    supplyStage: "input",
    draftText: "",
    parsedDemand: null,
    supplyText: "",
    parsedSupply: null,
    answers: defaultAnswers(),
    renterFieldStates: {},
    renterInputVersion: 0,
    selectedLocations: [],
    consent: false,
    supplyDraft: freshSupplyDraft(),
    supplyFieldStates: {},
    supplyInputVersion: 0,
    supplyPledge: false,
    supplyValidation: null,
    supplyEvidenceRefs: {},
    evidenceUploading: null,
    photoPreviews: [],
    publicPhotoConsent: false,
    task: null,
    result: null,
    supplyResult: null,
    activeCandidateId: null,
    activeMatchCase: null,
    activeMatchCaseLoading: false,
    activeMatchCaseError: null,
    clarificationSubmitting: null,
    revealedContact: null,
    contactLoading: false,
    contactSubmitting: false,
    reportResult: null,
    taskNotices: [{ ...demoRenewalTask, lifecycle: createTaskLifecycle(addDaysToIso(todayInShanghai(), -25)) }],
    archivedTasks: [],
    messagesRead: false,
    regression: null
  };
  render();
}

app.addEventListener("input", (event) => {
  const input = event.target.closest("[data-input]");
  if (!input) return;
  const key = input.dataset.input;
  if (key === "draft-text") { state.draftText = input.value; state.parsedDemand = null; }
  if (key === "supply-text") { state.supplyText = input.value; state.parsedSupply = null; }
  if (key === "location-search") {
    state.locationSearch = input.value;
    const suggestions = app.querySelector(".location-suggestions");
    if (suggestions) suggestions.innerHTML = locationSuggestionMarkup(input.value);
  }
  if (key === "budget-min") confirmRenterAnswer("budgetMin", input.value);
  if (key === "budget-max") confirmRenterAnswer("budgetMax", input.value);
  if (key === "move-in-from") confirmRenterAnswer("moveInFrom", input.value);
  if (key === "move-in-to") confirmRenterAnswer("moveInTo", input.value);
  if (key === "commute-range") { confirmRenterAnswer("commute", input.value); const output = app.querySelector("#commute-value"); if (output) output.textContent = `${input.value} 分钟`; }
  if (key === "contact-value") {
    state.contactDraft = input.value;
    const type = app.querySelector("[data-contact-type]")?.value || "wechat";
    const message = validateContactValue(type, input.value);
    if (message && state.fieldErrors.contact) state.fieldErrors.contact = message;
    else if (!message) {
      delete state.fieldErrors.contact;
      app.querySelector("#field-error-contact")?.remove();
    }
    applyFieldErrorAttributes();
  }
  if (key === "supply-title") state.supplyDraft.title = input.value;
  if (key === "supply-address") state.supplyDraft.address = input.value;
  if (key === "supply-rent") {
    const rent = Number(input.value || 0);
    state.supplyDraft.listedRent = rent;
    state.supplyDraft.fees.rent = rent;
    if (!state.supplyDraft.fees.deposit) state.supplyDraft.fees.deposit = rent;
  }
  if (key === "supply-min-rent") state.supplyDraft.minimumAuthorizedRent = Number(input.value || 0);
  if (key === "supply-available") state.supplyDraft.availableFrom = input.value;
  if (key === "supply-lease") state.supplyDraft.leaseMonthsMin = input.value ? Number(input.value) : null;
  if (key === "supply-area") state.supplyDraft.areaSqm = Number(input.value || 0);
  if (key === "supply-floor") state.supplyDraft.floor = Number(input.value || 0);
  if (key === "supply-total-floors") state.supplyDraft.totalFloors = Number(input.value || 0);
  if (key === "supply-roommate-count") state.supplyDraft.roommateCount = Number(input.value || 0);
  if (key === "supply-location") {
    const area = marketplaceAreas.find((item) => item.location === input.value);
    state.supplyDraft.location = input.value;
    state.supplyDraft.district = area?.district || "";
    state.supplyDraft.station = area?.station || "";
  }
  if (key.startsWith("supply-") && key !== "supply-text") confirmSupplyField(key, input.value);
});

app.addEventListener("change", async (event) => {
  const contactType = event.target.closest("[data-contact-type]");
  if (contactType) {
    const contactInput = app.querySelector("[data-contact-value]");
    if (state.fieldErrors.contact && contactInput) {
      const message = validateContactValue(contactType.value, contactInput.value);
      if (message) state.fieldErrors.contact = message;
      else delete state.fieldErrors.contact;
      render();
    }
    return;
  }
  const evidenceInput = event.target.closest("[data-evidence-file]");
  if (evidenceInput?.files?.length) {
    const kind = evidenceInput.dataset.evidenceFile;
    const file = evidenceInput.files[0];
    state.evidenceUploading = kind;
    render();
    try {
      const uploaded = await uploadEvidenceFile(file, kind);
      state.supplyEvidenceRefs[kind] = uploaded.id;
      state.supplyDraft.verification[kind] = uploaded;
      confirmSupplyField(`verification.${kind}`, uploaded);
      state.evidenceUploading = null;
      showToast(uploaded.displayLabel || "已上传，待审核");
    } catch (error) {
      state.evidenceUploading = null;
      showToast(error.message || "材料上传失败");
    }
    return;
  }
  const input = event.target.closest("[data-file]");
  if (!input?.files?.length) return;
  const files = [...input.files].slice(0, 6);
  const previews = await Promise.all(files.map((file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ src: reader.result, label: file.name.replace(/\.[^.]+$/, "") || "房源照片", file });
    reader.readAsDataURL(file);
  })));
  state.photoPreviews = [...state.photoPreviews, ...previews].slice(-6);
  state.evidenceUploading = "livePhotoChallenge";
  render();
  try {
    const uploaded = await uploadEvidenceFile(files[0], "livePhotoChallenge");
    state.supplyEvidenceRefs.livePhotoChallenge = uploaded.id;
    state.supplyDraft.verification.livePhotoChallenge = uploaded;
    confirmSupplyField("verification.livePhotoChallenge", uploaded);
    state.evidenceUploading = null;
    queueModalFocusRestore();
    state.sheet = null;
    showToast(uploaded.displayLabel || "已上传，待审核");
  } catch (error) {
    state.evidenceUploading = null;
    state.photoPreviews = [];
    showToast(error.message || "现场照片上传失败");
  }
});

app.addEventListener("error", (event) => {
  const image = event.target.closest?.("img[data-listing-photo]");
  if (!image || image.dataset.fallbackApplied === "true") return;
  image.dataset.fallbackApplied = "true";
  image.src = "./assets/media-placeholder.svg";
  image.alt = "房源图片暂不可用";
  image.removeAttribute("fetchpriority");
}, true);

app.addEventListener("keydown", (event) => {
  const activeDialog = app.querySelector('.bottom-sheet[aria-modal="true"], .map-sheet[aria-modal="true"]');
  if (activeDialog) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeActiveSheet();
      return;
    }
    if (event.key === "Tab") focusManager.trapTab(event, activeDialog);
  }
  const draft = event.target.closest('[data-input="draft-text"]');
  if (draft && event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    beginIntake();
    return;
  }
  const supply = event.target.closest('[data-input="supply-text"]');
  if (supply && event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    beginSupplyIntake();
    return;
  }
  const search = event.target.closest('[data-input="location-search"]');
  if (search && event.key === "Enter" && search.value.trim()) {
    event.preventDefault();
    if (!state.selectedLocations.includes(search.value.trim())) state.selectedLocations.push(search.value.trim());
    confirmRenterAnswer("location", state.selectedLocations.join(" / "));
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
  if (["open-create", "task-center-create", "open-location", "open-photo-source", "open-share", "open-report", "open-lab", "open-contact-settings", "reveal-contact"].includes(action) && !state.sheet) {
    rememberModalTrigger(target);
  }
  switch (action) {
    case "retry-connection": await initializeServerState(); break;
    case "switch-tab":
      state.tab = value;
      state.page = "root";
      state.revealedContact = null;
      if (value === "messages") state.messagesRead = true;
      if (value === "results" && state.activeTaskId) pushRoute({ name: "task", taskId: state.activeTaskId });
      else pushRoute({ name: "home" });
      render();
      break;
    case "open-task-center": await showTaskCenter(); break;
    case "close-task-center":
      state.routeNotice = null;
      if (state.activeTaskId && state.tasks.some((task) => task.id === state.activeTaskId)) {
        await selectServerTask(state.activeTaskId);
      } else {
        state.page = "root";
        state.tab = "match";
        pushRoute({ name: "home" });
        render();
      }
      break;
    case "task-center-create":
      state.page = "root";
      state.tab = "match";
      state.sheet = "create";
      pushRoute({ name: "home" });
      render();
      break;
    case "open-task": await selectServerTask(target.dataset.id); break;
    case "set-task-status": {
      target.disabled = true;
      try {
        const response = await setServerTaskStatus(target.dataset.id, value);
        const index = state.tasks.findIndex((task) => task.id === response.task.id);
        if (index >= 0) state.tasks[index] = { ...state.tasks[index], ...response.task };
        if (state.task?.remoteId === response.task.id) state.task.status = response.task.status;
        await refreshTaskList();
        showToast(value === "active" ? "任务已恢复，将继续接收匹配" : "任务已暂停");
      } catch (error) {
        state.taskCenterError = error.message || "任务状态更新失败";
        render();
      }
      break;
    }
    case "open-create": state.sheet = "create"; render(); break;
    case "close-sheet":
    case "close-sheet-from-scrim": closeActiveSheet(); break;
    case "create-renter": modalTriggerFocusKey = null; state.sheet = null; state.flow = "renter"; state.renterStage = "input"; state.renterFieldStates = {}; state.renterInputVersion = 0; state.fieldErrors = {}; render(); break;
    case "create-supply": modalTriggerFocusKey = null; state.sheet = null; state.flow = "supply"; state.supplyStage = "input"; state.supplyText = ""; state.parsedSupply = null; state.supplyDraft = freshSupplyDraft(); state.supplyFieldStates = {}; state.supplyInputVersion = 0; state.supplyEvidenceRefs = {}; state.photoPreviews = []; state.publicPhotoConsent = false; state.fieldErrors = {}; render(); break;
    case "cancel-flow": state.flow = null; state.page = "root"; render(); break;
    case "voice-input": startVoiceInput(); break;
    case "home-intake": beginIntake(); break;
    case "start-intake": beginIntake(); break;
    case "start-supply-intake": beginSupplyIntake(); break;
    case "open-location": state.sheet = "location"; render(); break;
    case "toggle-location": {
      const index = state.selectedLocations.indexOf(value);
      if (index >= 0) state.selectedLocations.splice(index, 1); else state.selectedLocations.push(value);
      confirmRenterAnswer("location", state.selectedLocations.join(" / "));
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
    case "confirm-location": confirmRenterAnswer("location", state.selectedLocations.join(" / ")); closeActiveSheet(); break;
    case "set-answer": confirmRenterAnswer(target.dataset.key, value); render(); break;
    case "review-mandate": {
      const errors = validateDemandFields();
      state.fieldErrors = { ...state.fieldErrors, ...errors };
      for (const key of ["location", "budget", "moveIn", "commute", "lease"]) {
        if (!errors[key]) delete state.fieldErrors[key];
      }
      if (Object.keys(errors).length) {
        pendingInvalidFocus = true;
        render();
      } else {
        state.renterStage = "review";
        render();
      }
      break;
    }
    case "toggle-consent": state.consent = target.checked; app.querySelector('[data-action="publish-mandate"]')?.toggleAttribute("disabled", !state.consent); break;
    case "publish-mandate": {
      if (!state.consent) { showToast("请先确认需求"); break; }
      target.disabled = true;
      try {
        const snapshot = await createServerTask("renter", {
          mandate: mandateFromAnswers(),
          rawText: state.draftText,
          inputVersion: state.renterInputVersion,
          fieldStates: state.renterFieldStates
        });
        state.result = { scanned: snapshot.task.scanned, candidates: snapshot.candidates, audit: snapshot.events || [] };
        await launchBearAgent(app.querySelector('[data-bear-id="renter-review-bear"]'));
        startMatching("renter", snapshot.task);
      } catch (error) {
        target.disabled = false;
        showToast(error.message || "发布失败");
      }
      break;
    }
    case "set-supply-role": state.supplyDraft.role = value; confirmSupplyField("role", value); render(); break;
    case "trigger-evidence": app.querySelector(`#evidence-${value}`)?.click(); break;
    case "set-supply-detail": {
      const key = target.dataset.key;
      if (["kitchen", "washer", "elevator", "ensuite"].includes(key)) {
        const nextValue = value === "true";
        state.supplyDraft.facilities[key] = state.supplyDraft.facilities[key] === nextValue ? false : nextValue;
      } else if (["exposure", "washerType", "network"].includes(key)) {
        state.supplyDraft.facilities[key] = value;
      } else if (key === "roommateGender") {
        state.supplyDraft.roommateGender = value === "any" ? null : value;
      } else {
        state.supplyDraft[key] = value;
      }
      confirmSupplyField(key, value);
      render();
      break;
    }
    case "open-photo-source": state.sheet = "photo"; render(); break;
    case "trigger-camera": app.querySelector("#camera-input")?.click(); break;
    case "trigger-library": app.querySelector("#library-input")?.click(); break;
    case "scan-supply": {
      if (state.parsedSupply?.riskSignals.some((signal) => ["broker_role", "role_conflict", "prohibited_fee"].includes(signal))) {
        showToast("只接受房东本人或当前租客的零收费房源");
        break;
      }
      try {
        await refreshSupplyVerificationStatuses();
      } catch (error) {
        showToast(error.message || "核验状态刷新失败");
        break;
      }
      state.supplyValidation = validateSupplyDraft(state.supplyDraft);
      if (state.supplyValidation.valid) { state.supplyStage = "review"; render(); } else showToast(state.supplyValidation.errors[0]);
      break;
    }
    case "toggle-supply-pledge": state.supplyPledge = target.checked; app.querySelector('[data-action="publish-supply"]')?.toggleAttribute("disabled", !(state.supplyPledge && validateSupplyDraft(state.supplyDraft).valid)); break;
    case "publish-supply": {
      if (!state.supplyPledge) { showToast("请先确认零中介承诺"); break; }
      target.disabled = true;
      try {
        const snapshot = await createServerTask("supply", {
          draft: state.supplyDraft,
          rawText: state.supplyText,
          inputVersion: state.supplyInputVersion,
          fieldStates: state.supplyFieldStates,
          evidenceRefs: state.supplyEvidenceRefs
        });
        let failedPhotoUploads = 0;
        if (state.publicPhotoConsent) {
          for (const photo of state.photoPreviews) {
            if (!photo.file) continue;
            try {
              await uploadListingMedia(snapshot.task.id, photo.file, photo.label);
            } catch {
              failedPhotoUploads += 1;
            }
          }
        }
        state.supplyResult = { scanned: snapshot.task.scanned, candidates: snapshot.candidates, audit: snapshot.events || [] };
        await launchBearAgent(app.querySelector('[data-bear-id="supply-review-bear"]'));
        startMatching("supply", snapshot.task);
        if (failedPhotoUploads) showToast(`${failedPhotoUploads} 张公开照片处理失败，任务已正常发布`);
      } catch (error) {
        target.disabled = false;
        showToast(error.message || "发布失败");
      }
      break;
    }
    case "open-candidate": {
      state.activeCandidateId = target.dataset.id;
      state.page = "candidate";
      state.revealedContact = null;
      const candidate = activeCandidate();
      await loadActiveMatchCase();
      if (state.task?.remoteId && candidate?.matchCaseId) {
        pushRoute({ name: "match", taskId: state.task.remoteId, matchCaseId: candidate.matchCaseId });
      }
      break;
    }
    case "back-match-detail":
      if (history.state?.route === "match") history.back();
      else if (state.activeTaskId) await selectServerTask(state.activeTaskId, { replace: true });
      else {
        state.page = "root";
        replaceRoute({ name: "home" });
        render();
      }
      break;
    case "back-root": state.page = "root"; state.tab = "results"; state.activeMatchCase = null; state.activeMatchCaseError = null; state.revealedContact = null; render(); break;
    case "retry-match-case": await loadActiveMatchCase(); break;
    case "answer-clarification-option": await submitClarification(target.dataset.id, target.dataset.value); break;
    case "submit-clarification": {
      const clarificationId = target.dataset.id;
      let answer;
      if (target.dataset.type === "date_range") {
        answer = {
          from: app.querySelector(`[data-clarification-from="${CSS.escape(clarificationId)}"]`)?.value,
          to: app.querySelector(`[data-clarification-to="${CSS.escape(clarificationId)}"]`)?.value
        };
      } else {
        answer = app.querySelector(`[data-clarification-value="${CSS.escape(clarificationId)}"]`)?.value;
      }
      if (!answer || typeof answer === "object" && (!answer.from || !answer.to)) { showToast("请先填写答案"); break; }
      await submitClarification(clarificationId, answer);
      break;
    }
    case "confirm-match": {
      const matchCase = state.activeMatchCase;
      if (!matchCase?.currentTerms) break;
      target.disabled = true;
      try {
        const response = await confirmMatchCase(matchCase.id, matchCase.currentTerms.version, matchCase.currentTerms.hash);
        state.activeMatchCase = response.matchCase;
        state.revealedContact = null;
        showToast(response.idempotent ? "你已经确认过当前条款" : response.matchCase.status === "mutually_confirmed" ? "双方已确认同一条款" : "已确认，正在等待对方");
      } catch (error) {
        if (error.code === "CONTACT_REQUIRED") state.sheet = "contact";
        showToast(error.message || "确认失败");
        await loadActiveMatchCase();
      }
      break;
    }
    case "decline-match": {
      const matchCase = state.activeMatchCase;
      if (!matchCase?.currentTerms) break;
      target.disabled = true;
      try {
        const response = await declineMatchCase(matchCase.id, matchCase.currentTerms.version, matchCase.currentTerms.hash);
        state.activeMatchCase = response.matchCase;
        state.revealedContact = null;
        showToast(response.idempotent ? "你已经拒绝当前条款" : "已拒绝当前条款");
      } catch (error) {
        showToast(error.message || "拒绝失败");
        await loadActiveMatchCase();
      }
      break;
    }
    case "reveal-contact": {
      const matchCase = state.activeMatchCase;
      if (!matchCase?.contactUnlocked || state.contactLoading) break;
      state.contactLoading = true;
      render();
      try {
        const response = await getMatchContact(matchCase.id);
        state.revealedContact = response.contact;
      } catch (error) {
        state.revealedContact = null;
        showToast(error.message || "联系方式仍处于锁定状态");
        await loadActiveMatchCase();
      } finally {
        state.contactLoading = false;
        render();
      }
      break;
    }
    case "hide-contact": state.revealedContact = null; render(); break;
    case "contact-tenant": showToast("已发起双方确认"); break;
    case "open-share": state.sheet = "share"; render(); break;
    case "copy-listing": {
      const candidate = activeCandidate();
      if (candidate) { queueModalFocusRestore(); state.sheet = null; await copyText(listingShareText(candidate), "房源摘要已复制"); }
      break;
    }
    case "share-listing": { const candidate = activeCandidate(); if (candidate) await shareCandidate(candidate); break; }
    case "open-report": state.sheet = "report"; render(); break;
    case "set-report-type": state.reportType = value; render(); break;
    case "toggle-report-evidence": state.reportHasEvidence = target.checked; break;
    case "toggle-photo-consent": state.publicPhotoConsent = target.checked; break;
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
    case "open-settings": state.page = "settings"; state.sheet = null; state.revealedContact = null; render(); break;
    case "open-contact-settings": state.sheet = "contact"; render(); break;
    case "save-contact": {
      const type = app.querySelector("[data-contact-type]")?.value;
      const contactValue = app.querySelector("[data-contact-value]")?.value;
      const contactError = validateContactValue(type, contactValue);
      if (contactError) {
        state.fieldErrors.contact = contactError;
        pendingInvalidFocus = true;
        render();
        break;
      }
      target.disabled = true;
      state.contactSubmitting = true;
      try {
        const response = await setProfileContact(type, contactValue);
        state.contactProfile = response.contact;
        state.contactDraft = "";
        delete state.fieldErrors.contact;
        queueModalFocusRestore();
        state.sheet = null;
        showToast("联系方式已加密保存");
      } catch (error) {
        showToast(error.message || "联系方式保存失败");
      } finally {
        state.contactSubmitting = false;
        render();
      }
      break;
    }
    case "toggle-setting":
      state.settings[value] = !state.settings[value];
      render();
      break;
    case "setting-info": {
      const messages = {
        city: "体验版当前开放上海",
        retention: "所有找房和出租任务默认保留 30 天",
        privacy: "私密预算、底价与联系方式不会进入公开匹配记录",
        about: "住哪儿体验版 · 本地 100×100 测试市场"
      };
      showToast(messages[value] || "功能准备中");
      break;
    }
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
      state.task.events = [];
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
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
      await registration.update();
    } catch {
      // The app remains fully usable when offline support is unavailable.
    }
  });
}

window.addEventListener("popstate", () => void restoreRouteFromLocation());

render();
void initializeServerState();
