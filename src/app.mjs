import { baseMandate, demoSupplyDraft, labScenarios } from "./fixtures.mjs";
import { parseDemandText, parsedDemandTags } from "./demand-parser.mjs";
import {
  evaluateReport,
  runLabScenario,
  runRegressionSuite,
  validateSupplyDraft
} from "./simulation-engine.mjs";

const app = document.querySelector("#app");
const STORAGE_KEY = "qihe-prototype-state-v1";

const iconPaths = {
  lab: '<path d="M9 3v5l-4.8 8.3A3.1 3.1 0 0 0 6.9 21h10.2a3.1 3.1 0 0 0 2.7-4.7L15 8V3"/><path d="M7 14h10M8 3h8"/>',
  mandate: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 12h6M9 16h5"/>',
  progress: '<path d="M4 18V9m6 9V5m6 13v-7m4 7H2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  mic: '<rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
  arrow: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.7 3.1 7.6 7.5 9.5 4.4-1.9 7.5-4.8 7.5-9.5V6z"/><path d="m9 12 2 2 4-5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  report: '<path d="M5 21V4m0 1h11l-2 4 2 4H5"/>',
  camera: '<path d="M4 7h3l1.5-2h7L17 7h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
  home: '<path d="m3 11 9-8 9 8v10h-6v-6H9v6H3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  spark: '<path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4z"/><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>'
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

function loadStoredState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

const stored = loadStoredState();
const defaults = window.QIHE_TWEAK_DEFAULTS || { theme: "paper", density: "comfortable", motion: "full" };
const savedTheme = ["paper", "mono", "night"].includes(stored.theme) ? stored.theme : defaults.theme;

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

function formatChineseDate(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return year && month && day ? `${year} 年 ${month} 月 ${day} 日` : "未填写";
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

let state = {
  mode: "renter",
  tab: "mandate",
  renterStage: "input",
  supplyStage: "draft",
  page: "root",
  draftText: "",
  parsedDemand: null,
  listening: false,
  answers: defaultAnswers(),
  consent: false,
  supplyPledge: false,
  supplyDraft: structuredClone(demoSupplyDraft),
  supplyValidation: null,
  result: null,
  activeScenario: "full-demo",
  activeCandidateId: null,
  sheet: null,
  reportType: "broker_or_fee",
  reportHasEvidence: false,
  reportResult: null,
  regression: null,
  toast: null,
  theme: savedTheme,
  density: stored.density || defaults.density,
  motion: stored.motion || defaults.motion
};

let toastTimer = null;
let lastViewKey = null;
let voiceRecognition = null;

function persistTweaks() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ theme: state.theme, density: state.density, motion: state.motion })
  );
}

function seedAnswersFromParsed(parsed) {
  const fields = parsed?.fields;
  if (!fields) return;
  if (fields.locations.length) state.answers.location = fields.locations.join(" / ");
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
  const typedLocations = state.answers.location
    .split(/(?:、|\/|，|,)/)
    .map((item) => item.trim())
    .filter(Boolean);
  const targetBudget = parsed?.budget?.target || Number(state.answers.budgetMin);
  const hardMax = parsed?.budget?.hardMax || Number(state.answers.budgetMax);
  mandate.city = parsed?.city || "上海";
  mandate.locations = parsed?.locations?.length ? [...parsed.locations] : typedLocations;
  mandate.maxCommuteMinutes = parsed?.maxCommuteMinutes || Number(state.answers.commute);
  mandate.budget.target = targetBudget;
  mandate.budget.hardMax = hardMax;
  mandate.moveInWindow = structuredClone(parsed?.moveInWindow || {
    from: state.answers.moveInFrom,
    to: state.answers.moveInTo,
    label: ""
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
  if (parsed?.preferences?.washerType) mandate.preferences.washerType = `${parsed.preferences.washerType}_preferred`;
  if (parsed?.preferences?.exposure) mandate.preferences.exposure = `${parsed.preferences.exposure}_preferred`;
  return mandate;
}

function validateDemandAnswers() {
  const parsed = state.parsedDemand?.fields;
  const locations = parsed?.locations?.length ? parsed.locations : state.answers.location.trim();
  if (!locations.length) return "请填写想住的位置";

  const budgetMin = parsed?.budget?.target || Number(state.answers.budgetMin);
  const budgetMax = parsed?.budget?.hardMax || Number(state.answers.budgetMax);
  if (!budgetMin || !budgetMax) return "请填写月租范围";
  if (budgetMin < 500 || budgetMax < budgetMin) return "月租范围需要从低到高";

  const moveInFrom = parsed?.moveInWindow?.from || state.answers.moveInFrom;
  const moveInTo = parsed?.moveInWindow?.to || state.answers.moveInTo;
  if (!moveInFrom || !moveInTo) return "请填写入住日期范围";
  if (moveInTo < moveInFrom) return "最晚入住日期不能早于最早日期";

  const commute = parsed?.maxCommuteMinutes || Number(state.answers.commute);
  if (commute < 15 || commute > 60) return "通勤时间需在 15 到 60 分钟之间";
  return null;
}

function applyTweaks() {
  document.body.dataset.theme = state.theme;
  document.body.dataset.density = state.density;
  document.body.dataset.motion = state.motion;
}

function announceTweak(key, value) {
  window.parent?.postMessage({ type: "__edit_mode_set_keys", edits: { [key]: value } }, "*");
}

function showToast(message) {
  state.toast = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = null;
    render();
  }, 2200);
}

function startVoiceInput() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    app.querySelector("#demand-input")?.focus();
    showToast("当前浏览器暂不支持语音输入");
    return;
  }

  voiceRecognition?.stop();
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
  voiceRecognition.onerror = () => {
    state.listening = false;
    showToast("没有听清，再试一次");
  };
  voiceRecognition.onend = () => {
    if (!state.listening) return;
    state.listening = false;
    render();
  };
  voiceRecognition.start();
}

function statusBar() {
  return `
    <div class="status-bar" aria-hidden="true">
      <span>9:41</span>
      <span class="status-icons">
        <span class="status-signal"><i></i><i></i><i></i><i></i></span>
        <span>5G</span>
        <span class="battery"></span>
      </span>
    </div>`;
}

function topArea() {
  return `
    <header class="top-area">
      <div class="brand-row">
        <p class="brand-name">栖合</p>
        <button class="icon-button lab-entry" data-action="open-lab" aria-label="打开测试台">
          ${icon("lab")}
        </button>
      </div>
      <div class="intent-switch" role="tablist" aria-label="切换租房意图">
        <button role="tab" aria-selected="${state.mode === "renter"}" data-action="switch-mode" data-value="renter">找房</button>
        <button role="tab" aria-selected="${state.mode === "supply"}" data-action="switch-mode" data-value="supply">出租</button>
      </div>
    </header>`;
}

function tabBar() {
  const labels = state.mode === "renter"
    ? [
        ["mandate", "mandate", "委托"],
        ["progress", "progress", "进展"],
        ["profile", "user", "我的"]
      ]
    : [
        ["mandate", "home", "房源"],
        ["progress", "progress", "匹配"],
        ["profile", "user", "我的"]
      ];

  return `
    <nav class="tab-bar" aria-label="主要导航">
      ${labels.map(([tab, iconName, label]) => `
        <button data-action="switch-tab" data-value="${tab}" aria-current="${state.tab === tab ? "page" : "false"}">
          ${icon(iconName)}<span>${label}</span>
        </button>`).join("")}
    </nav>`;
}

function renterInput() {
  return `
    <section class="screen-enter home-landing">
      <div class="home-intro">
        <h1>你想住哪儿？</h1>
      </div>

      <div class="composer" data-state="${state.draftText.trim() ? "ready" : "empty"}">
        <textarea id="demand-input" data-input="draft-text" aria-label="输入找房需求" placeholder="输入找房需求">${escapeHtml(state.draftText)}</textarea>
        <div class="composer-actions">
          <button class="voice-button ${state.listening ? "is-listening" : ""}" data-action="voice-input" aria-label="语音输入">
            ${icon("mic")}
          </button>
          <span class="composer-spacer"></span>
          <button class="composer-submit" data-action="start-intake" aria-label="继续">${icon("arrow")}</button>
        </div>
      </div>
    </section>`;
}

function answerChip(key, value, label) {
  return `<button class="choice-chip" data-action="set-answer" data-key="${key}" data-value="${value}" aria-pressed="${String(state.answers[key]) === String(value)}">${label}</button>`;
}

function coreQuestionCard(key, index) {
  const number = String(index + 1).padStart(2, "0");
  const today = todayInShanghai();
  const controls = {
    location: {
      title: "想住在哪一带？",
      body: `<label class="single-input-shell"><span>${icon("compass")}</span><input type="search" autocomplete="off" data-input="answer-location" aria-label="地铁站、商圈或地址" placeholder="地铁站、商圈或地址" value="${escapeHtml(state.answers.location)}" /></label>`
    },
    budget: {
      title: "月租控制在多少？",
      body: `<div class="paired-inputs budget-inputs">
        <label><span>理想</span><div class="number-input"><b>¥</b><input type="number" min="500" step="100" inputmode="numeric" data-input="budget-min" aria-label="理想月租" placeholder="3000" value="${escapeHtml(state.answers.budgetMin)}" /></div></label>
        <span class="range-separator">—</span>
        <label><span>最高</span><div class="number-input"><b>¥</b><input type="number" min="500" step="100" inputmode="numeric" data-input="budget-max" aria-label="最高月租" placeholder="4000" value="${escapeHtml(state.answers.budgetMax)}" /></div></label>
      </div>`
    },
    moveIn: {
      title: "什么时候入住？",
      body: `<div class="paired-inputs date-inputs">
        <label><span>最早</span><input type="date" min="${today}" data-input="move-in-from" aria-label="最早入住日期" value="${escapeHtml(state.answers.moveInFrom)}" /></label>
        <span class="range-separator">—</span>
        <label><span>最晚</span><input type="date" min="${escapeHtml(state.answers.moveInFrom || today)}" data-input="move-in-to" aria-label="最晚入住日期" value="${escapeHtml(state.answers.moveInTo)}" /></label>
      </div>`
    },
    housing: {
      title: "整租还是合租？",
      body: `<div class="choice-row">${answerChip("roommate", "no_share", "整租")}${answerChip("roommate", "female", "女生合租")}${answerChip("roommate", "male", "男生合租")}${answerChip("roommate", "any", "都可以")}</div>`
    },
    commute: {
      title: "最长能接受多久通勤？",
      body: `<div class="commute-control">
        <output id="commute-value" for="commute-range">${escapeHtml(state.answers.commute)} 分钟</output>
        <input id="commute-range" type="range" min="15" max="60" step="5" data-input="commute-range" aria-label="最长通勤时间" value="${escapeHtml(state.answers.commute)}" />
        <div class="range-bounds"><span>15 分钟</span><span>60 分钟</span></div>
      </div>`
    }
  };
  const control = controls[key];
  return `<div class="question-card"><span class="question-number">${number}</span><h3>${control.title}</h3>${control.body}</div>`;
}

function preferenceRow(key) {
  const rows = {
    ensuite: ["独卫", answerChip("bathroom", "required", "必须") + answerChip("bathroom", "preferred", "优先") + answerChip("bathroom", "any", "不限")],
    elevator: ["电梯", answerChip("elevator", "required", "必须") + answerChip("elevator", "preferred", "高楼要") + answerChip("elevator", "any", "不限")],
    utilities: ["水电", answerChip("utilities", "residential", "民用") + answerChip("utilities", "known", "透明即可") + answerChip("utilities", "any", "不限")],
    kitchen: ["厨房", answerChip("kitchen", "required", "需要") + answerChip("kitchen", "any", "不限")],
    washer: ["洗衣机", answerChip("washer", "required", "需要") + answerChip("washer", "any", "不限")]
  };
  const [label, controls] = rows[key];
  return `<div class="preference-row"><span>${label}</span><div class="mini-choice-row">${controls}</div></div>`;
}

function renterClarify() {
  const parsed = state.parsedDemand || parseDemandText(state.draftText);
  const tags = parsedDemandTags(parsed);
  const missingCore = parsed.coreMissing;
  const missingPreferences = parsed.preferenceMissing;
  return `
    <section class="screen-enter intake-screen">
      <div class="stage-nav"><button data-action="back-intake">${icon("back")} 修改原话</button><span></span></div>
      <div class="intake-heading">
        <h1>${missingCore.length ? "补充需求" : "居住偏好"}</h1>
        ${tags.length ? `<div class="analysis-strip">${tags.map((tag) => `<span class="meta-chip">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      </div>
      ${missingCore.map(coreQuestionCard).join("")}
      ${missingPreferences.length ? `<div class="preference-panel"><div class="compact-heading"><h2>居住偏好</h2></div>${missingPreferences.map(preferenceRow).join("")}</div>` : ""}
      <div class="sticky-action">
        <button class="primary-button button-full" data-action="review-mandate">确认需求 ${icon("arrow")}</button>
      </div>
    </section>`;
}

function renterReview() {
  const mandate = mandateFromAnswers();
  const roommateLabel = !mandate.sharedHousing ? "整租" : mandate.roommateGender === "female" ? "女生合租" : mandate.roommateGender === "male" ? "男生合租" : "可合租";
  const moveInLabel = mandate.moveInWindow.label || `${mandate.moveInWindow.from.slice(5).replace("-", ".")}—${mandate.moveInWindow.to.slice(5).replace("-", ".")}`;
  const budgetLabel = mandate.budget.target === mandate.budget.hardMax
    ? `¥${mandate.budget.target.toLocaleString("zh-CN")}`
    : `¥${mandate.budget.target.toLocaleString("zh-CN")}—${mandate.budget.hardMax.toLocaleString("zh-CN")}`;
  const mustHave = [
    mandate.hardConstraints.kitchen ? "厨房" : null,
    mandate.hardConstraints.washer ? "洗衣机" : null,
    mandate.hardConstraints.ensuite ? "独卫" : null,
    mandate.hardConstraints.elevator ? "电梯" : null
  ].filter(Boolean);
  return `
    <section class="screen-enter review-screen">
      <div class="stage-nav"><button data-action="edit-mandate">${icon("back")} 返回修改</button><span></span></div>
      <div class="review-heading"><h1>确认需求</h1></div>

      <div class="summary-card mandate-sheet">
        <dl class="summary-list">
          <div class="summary-row"><dt>区域</dt><dd>${mandate.locations.join(" / ")}</dd></div>
          <div class="summary-row"><dt>预算</dt><dd>${budgetLabel} / 月</dd></div>
          <div class="summary-row"><dt>入住</dt><dd>${moveInLabel}</dd></div>
          <div class="summary-row"><dt>通勤</dt><dd>不超过 ${mandate.maxCommuteMinutes} 分钟</dd></div>
          <div class="summary-row"><dt>合租</dt><dd>${roommateLabel}</dd></div>
          <div class="summary-row"><dt>必须有</dt><dd>${mustHave.length ? mustHave.join("、") : "无"}</dd></div>
        </dl>
      </div>

      <details class="private-box">
        <summary><span>${icon("lock")} 议价范围（仅自己可见）</span></summary>
        <ul>
          <li>目标 ¥${mandate.budget.target.toLocaleString("zh-CN")}</li>
          <li>最高 ¥${mandate.budget.hardMax.toLocaleString("zh-CN")}</li>
        </ul>
      </details>

      <label class="consent-row">
        <input type="checkbox" data-action="toggle-consent" ${state.consent ? "checked" : ""} />
        <span>按以上条件寻找，结果由我确认</span>
      </label>

      <div class="sticky-action">
        <button class="primary-button button-full" data-action="publish-mandate" ${state.consent ? "" : "disabled"}>开始找房 ${icon("arrow")}</button>
      </div>
    </section>`;
}

function renterHome() {
  if (state.renterStage === "clarify") return renterClarify();
  if (state.renterStage === "review") return renterReview();
  return renterInput();
}

function roomVisualClass(listingId) {
  if (["home-nanyang", "home-longde"].includes(listingId)) return "room-1";
  if (["home-jiangsu", "home-unknown-utilities"].includes(listingId)) return "room-2";
  return "room-3";
}

function selectionTitle(label) {
  return ({ "综合最合适": "首选", "预算最轻": "省预算", "居住条件最好": "住得好" })[label] || label;
}

function candidateCard(candidate, index) {
  const listing = candidate.listing;
  const firstCaveat = candidate.caveats[0] || "无明显冲突";
  return `
    <article class="candidate-card">
      <button class="candidate-card-button" data-action="open-candidate" data-id="${listing.id}" aria-label="查看 ${listing.shortTitle}">
        <div class="property-photo ${roomVisualClass(listing.id)}">
          <span class="card-index">${String(index + 1).padStart(2, "0")}</span>
          <span class="selection-badge">${selectionTitle(candidate.selectionLabel)}</span>
        </div>
        <div class="candidate-body">
          <div class="candidate-title-row">
            <div><h3>${listing.shortTitle}</h3><p>${listing.station} · 步行 ${listing.walkMinutes} 分钟</p></div>
            <div class="rent">¥${candidate.agreedRent.toLocaleString("zh-CN")}<small>/月</small></div>
          </div>
          <div class="fact-chips"><span>通勤 ${listing.commuteMinutes} 分钟</span><span>${listing.room.areaSqm}㎡</span><span>${listing.room.roommateCount} 位室友</span></div>
          <div class="candidate-footer">
            <span class="caveat-line">${firstCaveat}</span>
            <span class="card-open">已核验 ${icon("arrow")}</span>
          </div>
        </div>
      </button>
    </article>`;
}

function renterProgress() {
  if (!state.result) {
    return `
      <section class="screen-enter">
        <div class="empty-card">
          <div class="empty-symbol">${icon("compass")}</div>
          <h2>还没有运行中的委托</h2>
          <button class="primary-button" data-action="go-create">创建找房委托</button>
        </div>
      </section>`;
  }

  const result = state.result;
  const hasCandidates = result.candidates.length > 0;
  return `
    <section class="screen-enter">
      <div class="result-hero">
        <div class="result-state">${hasCandidates ? "持续寻找中" : "本轮已完成"}</div>
        <h1>${hasCandidates ? `找到 ${result.candidates.length} 套` : "暂时没有合适的"}</h1>
        <div class="result-stats">
          <div class="result-stat"><strong>${result.scanned}</strong><span>看过</span></div>
          <div class="result-stat"><strong>${result.excludedCount}</strong><span>不合适</span></div>
          <div class="result-stat"><strong>${result.quarantinedCount}</strong><span>已隔离</span></div>
        </div>
      </div>

      <button class="audit-summary-button" data-action="open-audit">
        <span class="audit-icon">${icon("list")}</span>
        <span><strong>筛选记录</strong><small>${result.scanned} 套房源 · ${result.audit.length} 条事件</small></span>
        ${icon("arrow")}
      </button>

      ${hasCandidates ? `
        <section class="section">
          <div class="section-header"><h2>候选</h2><p>${result.finishedAt ? "刚刚更新" : ""}</p></div>
          ${result.candidates.map(candidateCard).join("")}
        </section>` : `
        <div class="empty-card">
          <div class="empty-symbol">${icon("shield")}</div>
          <h2>暂时没有匹配</h2>
          <button class="secondary-button" data-action="edit-mandate">修改需求</button>
        </div>`}
    </section>`;
}

function activeCandidate() {
  return state.result?.candidates.find((candidate) => candidate.listing.id === state.activeCandidateId) || null;
}

function sourceClass(source) {
  if (source === "尚未确认") return "unknown";
  if (["平台核验", "实时核验", "AI 协商确认"].includes(source)) return "verified";
  return "";
}

function candidateDetail() {
  const candidate = activeCandidate();
  if (!candidate) return auditPage();
  const listing = candidate.listing;
  return `
    <section class="screen-enter detail-screen">
      <div class="detail-topbar floating-topbar">
        <button class="icon-button" data-action="back-root" aria-label="返回候选列表">${icon("back")}</button>
        <h1>${selectionTitle(candidate.selectionLabel)}</h1>
        <button class="icon-button" data-action="open-report" aria-label="举报此房源">${icon("report")}</button>
      </div>
      <div class="property-photo detail-photo ${roomVisualClass(listing.id)}"><span class="detail-photo-mark">${listing.publisher}</span></div>
      <div class="detail-content">
        <div class="detail-title-row">
          <h2 class="detail-title">${listing.shortTitle}</h2>
          <div class="detail-rent">¥${candidate.agreedRent.toLocaleString("zh-CN")}<small>/月</small></div>
        </div>
        <p class="candidate-meta"><span>${listing.station} · 步行 ${listing.walkMinutes} 分钟</span><span>通勤 ${listing.commuteMinutes} 分钟</span></p>
        <div class="fact-chips detail-facts"><span>${listing.room.areaSqm}㎡</span><span>${listing.room.floor}/${listing.room.totalFloors} 层</span><span>${listing.room.roommateCount} 位室友</span></div>

        <div class="agreement-ticket">
          <span>当前意向</span>
          <strong>¥${candidate.agreedRent.toLocaleString("zh-CN")} / 月</strong>
          <p>${candidate.agreementLabel || "等待双方本人确认"}</p>
        </div>

        <section class="section">
          <div class="section-header"><h2>符合</h2><p>${candidate.score}%</p></div>
          <ul class="plain-list positive">${candidate.reasons.map((reason) => `<li>${reason}</li>`).join("")}</ul>
        </section>

        <section class="section">
          <div class="section-header"><h2>留意</h2><p>${candidate.caveats.length} 项</p></div>
          <ul class="plain-list warning">${candidate.caveats.map((reason) => `<li>${reason}</li>`).join("") || "<li>仍需现场确认。</li>"}</ul>
        </section>

        <section class="section">
          <div class="section-header"><h2>来源</h2><p>已核验</p></div>
          <div class="summary-card">
            ${candidate.provenance.map((item) => `
              <div class="fact-row">
                <span class="fact-label">${item.label}<br /><span class="source-badge ${sourceClass(item.source)}">${item.source}</span></span>
                <span class="fact-value">${item.value}</span>
              </div>`).join("")}
          </div>
        </section>

        <section class="section">
          <div class="section-header"><h2>协商记录</h2><p>${candidate.negotiation.publicEvents.length} 条</p></div>
          <div class="timeline">
            ${candidate.negotiation.publicEvents.map((event) => `
              <div class="timeline-item">
                <span class="timeline-dot"></span>
                <div class="timeline-copy"><strong>${event.title}</strong><span>${event.detail}</span><small>${event.actor}</small></div>
              </div>`).join("")}
          </div>
        </section>

        <button class="primary-button button-full" data-action="confirm-candidate">申请联系</button>
        <button class="report-link" data-action="open-report">举报房源</button>
      </div>
    </section>`;
}

function auditPage() {
  const result = state.result;
  return `
    <section class="screen-enter">
      <div class="detail-topbar">
        <button class="icon-button" data-action="back-root" aria-label="返回进展">${icon("back")}</button>
        <h1>筛选记录</h1>
        <span></span>
      </div>
      <div class="progress-header"><div class="eyebrow">${result?.scanned || 0} 套房源</div><h1 class="page-title">怎么筛出来的</h1></div>
      <div class="audit-card">
        ${(result?.audit || []).map((event) => `
          <article class="audit-event">
            <header><h3>${event.title}</h3><span class="actor">${event.actor}</span></header>
            <p>${event.detail}</p>
          </article>`).join("") || "<p>暂无记录。</p>"}
      </div>
      ${result?.quarantinedCount ? `<div class="risk-banner"><strong>${result.quarantinedCount} 套风险房源已隔离；证据确认后封禁实名主体</strong></div>` : ""}
    </section>`;
}

function supplyDraftScreen() {
  const draft = state.supplyDraft;
  return `
    <section class="screen-enter">
      <div class="hero">
        <h1>发布房源</h1>
      </div>

      <section class="section">
        <span class="field-label">发布身份</span>
        <div class="role-options">
          <button class="role-option" data-action="set-supply-role" data-value="landlord" aria-pressed="${draft.role === "landlord"}"><strong>房东本人</strong></button>
          <button class="role-option" data-action="set-supply-role" data-value="subletter" aria-pressed="${draft.role === "subletter"}"><strong>当前租客</strong></button>
        </div>
      </section>

      <section class="section">
        <div class="supply-card">
          <div class="field-group">
            <label for="supply-title">房源一句话</label>
            <input id="supply-title" class="text-field" data-input="supply-title" value="${escapeHtml(draft.title)}" />
          </div>
          <div class="field-group">
            <label for="supply-address">完整地址（仅用于核验）</label>
            <textarea id="supply-address" class="text-field" data-input="supply-address">${escapeHtml(draft.address)}</textarea>
          </div>
          <div class="field-group">
            <label for="supply-rent">挂牌月租</label>
            <input id="supply-rent" class="text-field" inputmode="numeric" data-input="supply-rent" value="${draft.listedRent}" />
          </div>
          <div class="field-group">
            <label for="supply-available">可入住日期</label>
            <input id="supply-available" class="text-field" type="date" min="${todayInShanghai()}" data-input="supply-available" value="${escapeHtml(draft.availableFrom)}" />
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-header"><h2>现场拍摄</h2></div>
        <div class="photo-challenge">
          <div class="photo-tile done">${icon("camera")}卧室 + 指定手势</div>
          <div class="photo-tile done">${icon("camera")}窗外 + 当日码</div>
          <div class="photo-tile done">${icon("camera")}厨房 + 水表</div>
        </div>
      </section>

      <section class="section">
        <div class="section-header"><h2>费用</h2></div>
        <div class="summary-card">
          <div class="fee-row"><span class="fee-label">租金</span><span class="fee-value">¥${draft.listedRent}/月</span></div>
          <div class="fee-row"><span class="fee-label">押金</span><span class="fee-value">¥${draft.fees.deposit}</span></div>
          <div class="fee-row"><span class="fee-label">水电</span><span class="fee-value">${draft.fees.utilities}</span></div>
          <div class="fee-row"><span class="fee-label">中介 / 服务费</span><span class="fee-value">¥0</span></div>
        </div>
      </section>

      <div class="sticky-action">
        <button class="primary-button button-full" data-action="scan-supply">检查并继续 ${icon("arrow")}</button>
      </div>
    </section>`;
}

function supplyReviewScreen() {
  const validation = state.supplyValidation || validateSupplyDraft(state.supplyDraft);
  return `
    <section class="screen-enter">
      <div class="progress-header">
        <h1 class="page-title">确认房源</h1>
      </div>

      <div class="verification-grid">
        <div class="verification-item">${icon("check")}<span>身份</span></div>
        <div class="verification-item">${icon("check")}<span>${state.supplyDraft.role === "landlord" ? "房东本人" : "当前租客"}</span></div>
        <div class="verification-item">${icon("check")}<span>出租权</span></div>
        <div class="verification-item">${icon("check")}<span>现场</span></div>
      </div>

      <section class="section">
        <div class="summary-card">
          <div class="summary-row"><span class="fact-label">可入住</span><span class="fact-value">${formatChineseDate(state.supplyDraft.availableFrom)}</span></div>
          <div class="summary-row"><span class="fact-label">挂牌租金</span><span class="fact-value">¥${state.supplyDraft.listedRent}/月</span></div>
          <div class="summary-row"><span class="fact-label">合租情况</span><span class="fact-value">2 位女生室友</span></div>
          <div class="summary-row"><span class="fact-label">基础设施</span><span class="fact-value">厨房、滚筒、电梯</span></div>
          <div class="summary-row"><span class="fact-label">额外费用</span><span class="fact-value">无</span></div>
        </div>
      </section>

      <details class="private-box">
        <summary><span>${icon("lock")} 议价范围（仅自己可见）</span></summary>
        <ul>
          <li>挂牌 ¥${state.supplyDraft.listedRent.toLocaleString("zh-CN")}</li>
          <li>自动协商底价 ¥${state.supplyDraft.minimumAuthorizedRent.toLocaleString("zh-CN")}</li>
        </ul>
      </details>

      ${validation.errors.length ? `<div class="risk-banner">${validation.errors.join("；")}</div>` : ""}
      <label class="consent-row">
        <input type="checkbox" data-action="toggle-supply-pledge" ${state.supplyPledge ? "checked" : ""} />
        <span>我是房东本人或当前租客，不收中介费或服务费。</span>
      </label>

      <div class="sticky-action">
        <button class="primary-button button-full" data-action="publish-supply" ${state.supplyPledge && validation.valid ? "" : "disabled"}>发布房源</button>
      </div>
    </section>`;
}

function supplyPublishedScreen() {
  return `
    <section class="screen-enter">
      <div class="success-seal">${icon("check")}</div>
      <div class="center-copy">
        <h1>已发布</h1>
      </div>
      <section class="section">
        <div class="summary-card">
          <div class="fact-row"><span class="fact-label">房源状态</span><span class="fact-value">等待匹配</span></div>
          <div class="fact-row"><span class="fact-label">发布身份</span><span class="fact-value">${state.supplyDraft.role === "landlord" ? "房东本人" : "当前租客"} · 已核验</span></div>
          <div class="fact-row"><span class="fact-label">现场信息有效期</span><span class="fact-value">还剩 7 天</span></div>
          <div class="fact-row"><span class="fact-label">联系</span><span class="fact-value">双方确认后开放</span></div>
        </div>
      </section>
      <button class="secondary-button button-full" data-action="reset-supply">发布另一套</button>
    </section>`;
}

function supplyHome() {
  if (state.supplyStage === "review") return supplyReviewScreen();
  if (state.supplyStage === "published") return supplyPublishedScreen();
  return supplyDraftScreen();
}

function supplyProgress() {
  if (state.supplyStage !== "published") {
    return `
      <section class="screen-enter">
        <div class="empty-card">
          <div class="empty-symbol">${icon("home")}</div>
          <h2>房源还没发布</h2>
          <button class="primary-button" data-action="go-supply">去发布房源</button>
        </div>
      </section>`;
  }
  return `
    <section class="screen-enter">
      <div class="result-hero">
        <div class="result-state">持续匹配中</div>
        <h1>收到 7 份委托，2 份值得继续</h1>
        <div class="result-stats">
          <div class="result-stat"><strong>7</strong><span>进入初筛</span></div>
          <div class="result-stat"><strong>5</strong><span>硬条件冲突</span></div>
          <div class="result-stat"><strong>2</strong><span>正在协商</span></div>
        </div>
      </div>
      <div class="audit-card">
        <article class="audit-event"><header><h3>租户 A · 报价 ¥3,000</h3><span class="actor">条件命中</span></header><p>12 个月 · 8 月 29 日起租 · 已接受</p></article>
        <article class="audit-event"><header><h3>租户 B · 询问是否可养猫</h3><span class="actor">等待本人</span></header><p>宠物规则未填写</p></article>
        <article class="audit-event"><header><h3>租户 C · 最高 ¥2,800</h3><span class="actor">自动拒绝</span></header><p>低于自动协商底价</p></article>
      </div>
    </section>`;
}

function profileScreen() {
  return `
    <section class="screen-enter">
      <div class="hero">
        <h1>我的</h1>
      </div>
      <div class="verification-grid">
        <div class="verification-item">${icon("check")}<span>身份</span></div>
        <div class="verification-item">${icon("check")}<span>角色</span></div>
        <div class="verification-item">${icon("check")}<span>出租权</span></div>
        <div class="verification-item">${icon("check")}<span>现场</span></div>
      </div>
      <section class="section">
        <div class="policy-card">
          <h3>违规处理</h3>
          <p>冒充个人、收费、伪造材料、盗图：永久封禁实名主体</p>
        </div>
      </section>
      <section class="section">
        <div class="section-header"><h2>设置</h2></div>
        <div class="summary-card">
          <div class="setting-row"><span class="fact-label">测试台</span><button data-action="open-lab">打开</button></div>
          <div class="setting-row"><span class="fact-label">减少动态效果</span><button data-action="toggle-motion">${state.motion === "reduced" ? "已开启" : "未开启"}</button></div>
          <div class="setting-row"><span class="fact-label">重置所有流程</span><button data-action="reset-all">重置</button></div>
        </div>
      </section>
    </section>`;
}

function rootScreen() {
  if (state.tab === "profile") return profileScreen();
  if (state.mode === "renter") return state.tab === "progress" ? renterProgress() : renterHome();
  return state.tab === "progress" ? supplyProgress() : supplyHome();
}

function testLabSheet() {
  const passed = state.regression?.filter((item) => item.passed).length || 0;
  return `
    <div class="modal-scrim" data-action="close-sheet-from-scrim">
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="lab-title" data-sheet-body>
        <div class="sheet-handle"></div>
        <header class="sheet-header">
          <div><h2 id="lab-title">测试台</h2></div>
          <button class="icon-button" data-action="close-sheet" aria-label="关闭">${icon("close")}</button>
        </header>

        <div class="scenario-list">
          ${labScenarios.map((scenario, index) => `
            <button class="scenario-button" data-action="load-scenario" data-value="${scenario.id}" aria-current="${state.activeScenario === scenario.id}">
              <span class="scenario-index">0${index + 1}</span>
              <span><strong>${scenario.name}</strong></span>
              ${icon("arrow")}
            </button>`).join("")}
        </div>

        <section class="section">
          <div class="section-header"><h2>视觉</h2></div>
          <div class="theme-toggle">
            <button data-action="set-theme" data-value="paper" aria-pressed="${state.theme === "paper"}">白</button>
            <button data-action="set-theme" data-value="mono" aria-pressed="${state.theme === "mono"}">高对比</button>
            <button data-action="set-theme" data-value="night" aria-pressed="${state.theme === "night"}">夜间</button>
          </div>
        </section>

        <section class="section">
          <div class="section-header"><h2>信息密度</h2></div>
          <div class="density-toggle">
            <button data-action="set-density" data-value="compact" aria-pressed="${state.density === "compact"}">紧凑</button>
            <button data-action="set-density" data-value="comfortable" aria-pressed="${state.density === "comfortable"}">舒适</button>
            <button data-action="set-density" data-value="spacious" aria-pressed="${state.density === "spacious"}">宽松</button>
          </div>
        </section>

        <section class="section">
          <div class="section-header"><h2>规则回归</h2>${state.regression ? `<span class="section-count">${passed}/${state.regression.length}</span>` : ""}</div>
          ${state.regression ? `<div class="regression-list">${state.regression.map((item) => `
            <div class="regression-row"><span>${item.passed ? icon("check") : icon("close")}</span><span>${item.name}</span><span class="${item.passed ? "pass" : "fail"}">${item.passed ? "PASS" : "FAIL"}</span></div>`).join("")}</div>` : `<button class="secondary-button button-full" data-action="run-regression">运行全部检查</button>`}
        </section>
      </section>
    </div>`;
}

function reportSheet() {
  return `
    <div class="modal-scrim" data-action="close-sheet-from-scrim">
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="report-title" data-sheet-body>
        <div class="sheet-handle"></div>
        <header class="sheet-header">
          <div><h2 id="report-title">举报房源</h2></div>
          <button class="icon-button" data-action="close-sheet" aria-label="关闭">${icon("close")}</button>
        </header>
        ${[
          ["broker_or_fee", "冒充个人或索取中介 / 服务费"],
          ["mismatch", "现场与房源信息明显不符"],
          ["stolen_photo", "盗用或重复使用他人图片"],
          ["unavailable", "房源已租出或长期不回应"]
        ].map(([value, label]) => `<button class="report-option" data-action="set-report-type" data-value="${value}" aria-pressed="${state.reportType === value}"><span>${label}</span></button>`).join("")}

        <label class="consent-row">
          <input type="checkbox" data-action="toggle-report-evidence" ${state.reportHasEvidence ? "checked" : ""} />
          <span>附上站内索取费用的完整对话</span>
        </label>
        <button class="danger-button button-full" data-action="submit-report">提交举报并立即隔离</button>
      </section>
    </div>`;
}

function reportResultSheet() {
  const result = state.reportResult;
  const confirmed = result?.status === "identity_banned";
  return `
    <div class="modal-scrim" data-action="close-sheet-from-scrim">
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="report-result-title" data-sheet-body>
        <div class="sheet-handle"></div>
        <header class="sheet-header">
          <div><h2 id="report-result-title">处理结果</h2></div>
          <button class="icon-button" data-action="close-sheet" aria-label="关闭">${icon("close")}</button>
        </header>
        <div class="report-result">
          <h3>${confirmed ? "客观证据命中：实名级永久封禁" : "已立即隔离，等待证据复核"}</h3>
          <p><strong>立即动作：</strong>${result?.immediateAction}</p>
          <p><strong>最终动作：</strong>${result?.finalAction}</p>
          <p>保留申诉通道，但申诉期间不会恢复进入新匹配。</p>
        </div>
        <button class="secondary-button button-full" style="margin-top:12px" data-action="close-sheet">完成</button>
      </section>
    </div>`;
}

function activeSheet() {
  if (state.sheet === "lab") return testLabSheet();
  if (state.sheet === "report") return reportSheet();
  if (state.sheet === "report-result") return reportResultSheet();
  return "";
}

function render() {
  applyTweaks();
  const previousScrollTop = app.querySelector("#app-main")?.scrollTop || 0;
  const immersive = state.page === "candidate" || state.page === "audit";
  const viewKey = [state.mode, state.tab, state.renterStage, state.supplyStage, state.page, state.activeCandidateId || "none"].join(":");
  const shouldResetScroll = viewKey !== lastViewKey;
  const content = state.page === "candidate" ? candidateDetail() : state.page === "audit" ? auditPage() : rootScreen();
  app.innerHTML = `
    <div class="device">
      <div class="app-shell">
        ${statusBar()}
        ${immersive ? "" : topArea()}
        <main id="app-main" class="screen-scroll ${immersive ? "no-tabbar detail-scroll" : ""}" tabindex="-1">
          ${content}
        </main>
        ${immersive ? "" : tabBar()}
        ${activeSheet()}
        ${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ""}
      </div>
    </div>`;
  const main = app.querySelector("#app-main");
  if (main) main.scrollTop = shouldResetScroll ? 0 : previousScrollTop;
  lastViewKey = viewKey;
}

function resetAll() {
  const theme = state.theme;
  const density = state.density;
  const motion = state.motion;
  state = {
    ...state,
    mode: "renter",
    tab: "mandate",
    renterStage: "input",
    supplyStage: "draft",
    page: "root",
    draftText: "",
    parsedDemand: null,
    listening: false,
    answers: defaultAnswers(),
    consent: false,
    supplyPledge: false,
    supplyDraft: structuredClone(demoSupplyDraft),
    supplyValidation: null,
    result: null,
    activeScenario: "full-demo",
    activeCandidateId: null,
    sheet: null,
    reportResult: null,
    regression: null,
    theme,
    density,
    motion
  };
  render();
}

function beginIntake() {
  if (!state.draftText.trim()) {
    showToast("先输入找房需求");
    return;
  }
  state.parsedDemand = parseDemandText(state.draftText);
  state.answers = defaultAnswers();
  seedAnswersFromParsed(state.parsedDemand);
  state.consent = false;
  state.renterStage = state.parsedDemand.coreMissing.length || state.parsedDemand.preferenceMissing.length ? "clarify" : "review";
  render();
}

app.addEventListener("input", (event) => {
  const input = event.target.closest("[data-input]");
  if (!input) return;
  if (input.dataset.input === "draft-text") {
    state.draftText = input.value;
    state.parsedDemand = null;
  }
  if (input.dataset.input === "answer-location") state.answers.location = input.value;
  if (input.dataset.input === "budget-min") state.answers.budgetMin = input.value;
  if (input.dataset.input === "budget-max") state.answers.budgetMax = input.value;
  if (input.dataset.input === "move-in-from") {
    state.answers.moveInFrom = input.value;
    const endInput = app.querySelector('[data-input="move-in-to"]');
    if (endInput) {
      endInput.min = input.value || todayInShanghai();
      if (endInput.value && endInput.value < input.value) {
        endInput.value = input.value;
        state.answers.moveInTo = input.value;
      }
    }
  }
  if (input.dataset.input === "move-in-to") state.answers.moveInTo = input.value;
  if (input.dataset.input === "commute-range") {
    state.answers.commute = input.value;
    const output = app.querySelector("#commute-value");
    if (output) output.textContent = `${input.value} 分钟`;
  }
  if (input.dataset.input === "supply-title") state.supplyDraft.title = input.value;
  if (input.dataset.input === "supply-address") state.supplyDraft.address = input.value;
  if (input.dataset.input === "supply-available") state.supplyDraft.availableFrom = input.value;
  if (input.dataset.input === "supply-rent") {
    state.supplyDraft.listedRent = Number(input.value || 0);
    state.supplyDraft.fees.rent = Number(input.value || 0);
  }
});

app.addEventListener("keydown", (event) => {
  const input = event.target.closest('[data-input="draft-text"]');
  if (!input || event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  beginIntake();
});

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const value = target.dataset.value;

  if (action === "close-sheet-from-scrim" && event.target !== target) return;

  switch (action) {
    case "switch-mode":
      state.mode = value;
      state.tab = "mandate";
      state.page = "root";
      state.sheet = null;
      render();
      break;
    case "switch-tab":
      state.tab = value;
      state.page = "root";
      render();
      break;
    case "voice-input":
      startVoiceInput();
      break;
    case "start-intake":
      beginIntake();
      break;
    case "back-intake":
      state.renterStage = "input";
      render();
      break;
    case "set-answer":
      state.answers[target.dataset.key] = value;
      render();
      break;
    case "review-mandate": {
      const validationError = validateDemandAnswers();
      if (validationError) {
        showToast(validationError);
        break;
      }
      state.renterStage = "review";
      render();
      break;
    }
    case "toggle-consent":
      state.consent = target.checked;
      app.querySelector('[data-action="publish-mandate"]')?.toggleAttribute("disabled", !state.consent);
      break;
    case "publish-mandate": {
      if (!state.consent) {
        showToast("请先确认授权");
        break;
      }
      const { result } = runLabScenario(state.activeScenario, mandateFromAnswers());
      state.result = result;
      state.tab = "progress";
      state.page = "root";
      showToast(result.candidates.length ? `找到 ${result.candidates.length} 套` : "本轮没有合适房源");
      break;
    }
    case "go-create":
      state.tab = "mandate";
      state.renterStage = "input";
      render();
      break;
    case "edit-mandate":
      state.tab = "mandate";
      state.renterStage = "input";
      state.page = "root";
      render();
      break;
    case "open-candidate":
      state.activeCandidateId = target.dataset.id;
      state.page = "candidate";
      render();
      break;
    case "open-audit":
      state.page = "audit";
      render();
      break;
    case "back-root":
      state.page = "root";
      render();
      break;
    case "confirm-candidate":
      showToast("已向双方发出确认请求");
      break;
    case "open-report":
      state.sheet = "report";
      state.reportResult = null;
      render();
      break;
    case "set-report-type":
      state.reportType = value;
      render();
      break;
    case "toggle-report-evidence":
      state.reportHasEvidence = target.checked;
      break;
    case "submit-report": {
      const candidate = activeCandidate();
      if (!candidate) break;
      state.reportResult = evaluateReport({
        listing: candidate.listing,
        reportType: state.reportType,
        reporterEvidence: { inAppFeeMessage: state.reportHasEvidence }
      });
      state.sheet = "report-result";
      render();
      break;
    }
    case "set-supply-role":
      state.supplyDraft.role = value;
      render();
      break;
    case "scan-supply":
      state.supplyValidation = validateSupplyDraft(state.supplyDraft);
      if (state.supplyValidation.valid) {
        state.supplyStage = "review";
        render();
      } else {
        showToast(state.supplyValidation.errors[0]);
      }
      break;
    case "toggle-supply-pledge":
      state.supplyPledge = target.checked;
      app.querySelector('[data-action="publish-supply"]')?.toggleAttribute(
        "disabled",
        !(state.supplyPledge && (state.supplyValidation || validateSupplyDraft(state.supplyDraft)).valid)
      );
      break;
    case "publish-supply":
      if (!state.supplyPledge) {
        showToast("请先签署零中介承诺");
      } else {
        state.supplyStage = "published";
        showToast("房源已发布");
      }
      break;
    case "reset-supply":
      state.supplyStage = "draft";
      state.supplyPledge = false;
      render();
      break;
    case "go-supply":
      state.tab = "mandate";
      render();
      break;
    case "open-lab":
      state.sheet = "lab";
      render();
      break;
    case "close-sheet":
    case "close-sheet-from-scrim":
      state.sheet = null;
      render();
      break;
    case "load-scenario": {
      const { result } = runLabScenario(value);
      state.activeScenario = value;
      state.result = result;
      state.mode = "renter";
      state.tab = "progress";
      state.page = "root";
      state.sheet = null;
      showToast(`已载入：${labScenarios.find((item) => item.id === value)?.name}`);
      break;
    }
    case "run-regression":
      state.regression = runRegressionSuite();
      render();
      break;
    case "set-theme":
      state.theme = value;
      persistTweaks();
      announceTweak("theme", value);
      render();
      break;
    case "set-density":
      state.density = value;
      persistTweaks();
      announceTweak("density", value);
      render();
      break;
    case "toggle-motion":
      state.motion = state.motion === "reduced" ? "full" : "reduced";
      persistTweaks();
      announceTweak("motion", state.motion);
      render();
      break;
    case "reset-all":
      resetAll();
      showToast("已重置");
      break;
    default:
      break;
  }
});

window.addEventListener("message", (event) => {
  if (event.data?.type === "__activate_edit_mode") {
    state.sheet = "lab";
    render();
  }
  if (event.data?.type === "__deactivate_edit_mode") {
    state.sheet = null;
    render();
  }
});

window.parent?.postMessage({ type: "__edit_mode_available" }, "*");

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}

applyTweaks();
render();
