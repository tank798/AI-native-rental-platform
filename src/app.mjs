import { baseMandate, demoSupplyDraft, labScenarios } from "./fixtures.mjs";
import {
  evaluateReport,
  runLabScenario,
  runRegressionSuite,
  validateSupplyDraft
} from "./simulation-engine.mjs";

const app = document.querySelector("#app");
const STORAGE_KEY = "qihe-prototype-state-v1";

const exampleDemands = {
  commute: "我想在上海静安寺附近找房，预算 3000 左右，最晚 9 月初入住，通勤最好不超过 35 分钟，可以接受女生合租。",
  quiet: "想找江苏路附近安静一点的房间，预算不超过 3100，朝南最好，需要厨房和洗衣机，不接受任何中介或服务费。",
  value: "我想找 2700 到 3000 的个人转租，8 月底入住，能合租，但希望室友作息正常，水电一定要说清楚。"
};

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
const defaults = window.QIHE_TWEAK_DEFAULTS || { theme: "ledger", density: "comfortable", motion: "full" };

let state = {
  mode: "renter",
  tab: "mandate",
  renterStage: "input",
  supplyStage: "draft",
  page: "root",
  draftText: exampleDemands.commute,
  listening: false,
  answers: {
    roommate: "female",
    bathroom: "preferred",
    elevator: "preferred",
    utilities: "residential"
  },
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
  theme: stored.theme || defaults.theme,
  density: stored.density || defaults.density,
  motion: stored.motion || defaults.motion
};

let toastTimer = null;
let lastViewKey = null;

function persistTweaks() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ theme: state.theme, density: state.density, motion: state.motion })
  );
}

function mandateFromAnswers() {
  const mandate = structuredClone(baseMandate);
  mandate.roommateGender = state.answers.roommate === "female" ? "female" : null;
  mandate.sharedHousing = state.answers.roommate !== "no_share";
  mandate.hardConstraints.ensuite = state.answers.bathroom === "required";
  mandate.hardConstraints.elevator = state.answers.elevator === "required";
  mandate.preferences.ensuite = state.answers.bathroom;
  mandate.preferences.elevator = state.answers.elevator;
  mandate.preferences.utilities = state.answers.utilities;
  return mandate;
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
        <div class="brand-lockup">
          <p class="brand-name">栖合</p>
          <span class="beta-label">simulation</span>
        </div>
        <button class="icon-button" data-action="open-lab" aria-label="打开模拟测试台">
          ${icon("lab")}
        </button>
      </div>
      <div class="intent-switch" role="tablist" aria-label="切换租房意图">
        <button role="tab" aria-selected="${state.mode === "renter"}" data-action="switch-mode" data-value="renter">我要找房</button>
        <button role="tab" aria-selected="${state.mode === "supply"}" data-action="switch-mode" data-value="supply">我要出租</button>
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
    <section class="screen-enter">
      <div class="hero">
        <div class="eyebrow">把找房变成一份委托</div>
        <h1>说清需求，<br />剩下交给 AI。</h1>
        <p>你不用刷帖子，也不用反复解释。AI 会补全需求、核验房源并在授权范围内协商。</p>
        <div class="trust-line"><span class="trust-mark">${icon("shield")}</span>只匹配房东本人和当前承租人</div>
      </div>

      <div class="composer">
        <label for="demand-input">先随便说，不用一次讲完整</label>
        <textarea id="demand-input" data-input="draft-text" placeholder="例如：静安寺附近，预算 3000，9 月入住……">${escapeHtml(state.draftText)}</textarea>
        <div class="composer-actions">
          <button class="voice-button ${state.listening ? "is-listening" : ""}" data-action="simulate-voice" aria-label="模拟语音输入">
            ${icon("mic")}
          </button>
          <button class="primary-button" data-action="start-intake">让 AI 帮我补全 ${icon("arrow")}</button>
        </div>
      </div>

      <div class="sample-strip" aria-label="示例需求">
        <button class="sample-chip" data-action="sample-demand" data-value="commute">通勤优先示例</button>
        <button class="sample-chip" data-action="sample-demand" data-value="quiet">居住品质示例</button>
        <button class="sample-chip" data-action="sample-demand" data-value="value">预算优先示例</button>
      </div>

      <section class="section">
        <div class="section-header"><h2>AI 会替你做什么</h2><p>搜索阶段无需真人聊天</p></div>
        <div class="summary-card">
          <div class="fact-row"><span class="fact-label">补全需求</span><span class="fact-value">只追问关键缺口</span></div>
          <div class="fact-row"><span class="fact-label">核验供给</span><span class="fact-value">角色、权利、现场、费用</span></div>
          <div class="fact-row"><span class="fact-label">异步协商</span><span class="fact-value">不泄露私密底线</span></div>
          <div class="fact-row"><span class="fact-label">交付结果</span><span class="fact-value">最多 3 套，不凑数</span></div>
        </div>
      </section>
    </section>`;
}

function answerChip(key, value, label) {
  return `<button class="choice-chip" data-action="set-answer" data-key="${key}" data-value="${value}" aria-pressed="${state.answers[key] === value}">${label}</button>`;
}

function renterClarify() {
  return `
    <section class="screen-enter">
      <div class="progress-header">
        <div class="step-kicker"><span>需求补全</span><span>1 / 3</span></div>
        <div class="step-track"><span style="width:33%"></span></div>
        <h1 class="page-title">还有 4 个关键点</h1>
        <p class="page-subtitle">AI 已从你的描述里识别出位置、预算和入住时间。下面这些会直接影响是否匹配。</p>
        <div class="analysis-strip">
          <span class="meta-chip">静安寺周边</span><span class="meta-chip">目标 ¥3,000</span><span class="meta-chip">9 月初入住</span><span class="meta-chip">接受合租</span>
        </div>
      </div>

      <div class="question-card">
        <span class="question-number">01 · 硬性条件</span>
        <h3>合租时，对室友性别的要求？</h3>
        <p>不符合时会直接排除，不进入双方 AI 对话。</p>
        <div class="choice-row">
          ${answerChip("roommate", "female", "只接受女生室友")}
          ${answerChip("roommate", "any", "都可以")}
          ${answerChip("roommate", "no_share", "不接受合租")}
        </div>
      </div>

      <div class="question-card">
        <span class="question-number">02 · 加分偏好</span>
        <h3>独立卫生间有多重要？</h3>
        <div class="choice-row">
          ${answerChip("bathroom", "required", "必须有")}
          ${answerChip("bathroom", "preferred", "有最好")}
          ${answerChip("bathroom", "any", "无所谓")}
        </div>
      </div>

      <div class="question-card">
        <span class="question-number">03 · 居住便利</span>
        <h3>对电梯有什么要求？</h3>
        <div class="choice-row">
          ${answerChip("elevator", "required", "必须有")}
          ${answerChip("elevator", "preferred", "高楼层要有")}
          ${answerChip("elevator", "any", "无所谓")}
        </div>
      </div>

      <div class="question-card">
        <span class="question-number">04 · 费用透明</span>
        <h3>水电计价偏好？</h3>
        <div class="choice-row">
          ${answerChip("utilities", "residential", "民水民电优先")}
          ${answerChip("utilities", "known", "说清楚即可")}
        </div>
      </div>

      <div class="sticky-action">
        <button class="primary-button button-full" data-action="review-mandate">查看 AI 整理的委托 ${icon("arrow")}</button>
      </div>
    </section>`;
}

function renterReview() {
  const roommateLabel = state.answers.roommate === "female" ? "仅女生室友" : state.answers.roommate === "no_share" ? "不接受合租" : "不限";
  const bathroomLabel = state.answers.bathroom === "required" ? "必须独卫" : state.answers.bathroom === "preferred" ? "独卫加分" : "不限";
  return `
    <section class="screen-enter">
      <div class="progress-header">
        <div class="step-kicker"><span>确认委托</span><span>2 / 3</span></div>
        <div class="step-track"><span style="width:66%"></span></div>
        <h1 class="page-title">这是 AI 真正执行的版本</h1>
        <p class="page-subtitle">原话不会直接拿去搜房。硬性条件、偏好和可协商项必须分开。</p>
      </div>

      <div class="summary-card">
        <dl class="summary-list">
          <div class="summary-row"><dt>区域</dt><dd>静安寺 / 江苏路 / 隆德路</dd></div>
          <div class="summary-row"><dt>预算</dt><dd>目标 ¥3,000 · 最高私密</dd></div>
          <div class="summary-row"><dt>入住</dt><dd>8 月 28 日—9 月 5 日</dd></div>
          <div class="summary-row"><dt>合租</dt><dd>${roommateLabel}</dd></div>
          <div class="summary-row"><dt>卫生间</dt><dd>${bathroomLabel}</dd></div>
          <div class="summary-row"><dt>必须有</dt><dd>厨房、洗衣机、零中介费</dd></div>
        </dl>
      </div>

      <div class="private-box">
        <h3>${icon("lock")} 你的私密协商授权</h3>
        <ul>
          <li>目标 ¥3,000；AI 可在不披露上限的前提下协商。</li>
          <li>可用 12 个月租期、提前起租交换降价。</li>
          <li>任何结果都是非约束意向，未经本人确认不生效。</li>
        </ul>
      </div>

      <label class="consent-row">
        <input type="checkbox" data-action="toggle-consent" ${state.consent ? "checked" : ""} />
        <span>我授权 AI 按以上边界搜索和协商；AI 不得擅自突破硬性条件，也不得代表我签约。</span>
      </label>

      <div class="sticky-action">
        <button class="primary-button button-full" data-action="publish-mandate" ${state.consent ? "" : "disabled"}>确认委托，开始寻找 ${icon("compass")}</button>
      </div>
    </section>`;
}

function renterHome() {
  if (state.renterStage === "clarify") return renterClarify();
  if (state.renterStage === "review") return renterReview();
  return renterInput();
}

function candidateCard(candidate) {
  const listing = candidate.listing;
  const firstCaveat = candidate.caveats[0] || "暂无明显冲突";
  return `
    <article class="candidate-card">
      <div class="property-photo tone-${listing.photoTone}">
        <span class="selection-badge">${candidate.selectionLabel}</span>
        <span class="photo-badge">模拟照片 · ${listing.photoLabel}</span>
      </div>
      <div class="candidate-body">
        <div class="candidate-title-row">
          <div>
            <h3>${listing.shortTitle}</h3>
            <p class="candidate-meta"><span>${listing.station} ${listing.walkMinutes} 分钟</span><span>通勤 ${listing.commuteMinutes} 分钟</span></p>
          </div>
          <div class="rent">¥${candidate.agreedRent.toLocaleString("zh-CN")}<small>/月</small></div>
        </div>
        <div class="fit-line"><strong>为什么给你看：</strong>${candidate.reasons[0]}</div>
        <div class="caveat-line"><strong>先看缺点：</strong>${firstCaveat}</div>
        <div class="candidate-footer">
          <span class="proof-inline">${icon("shield")} 四项核验完成</span>
          <button class="secondary-button button-compact" data-action="open-candidate" data-id="${listing.id}">查看依据 ${icon("arrow")}</button>
        </div>
      </div>
    </article>`;
}

function renterProgress() {
  if (!state.result) {
    return `
      <section class="screen-enter">
        <div class="empty-card">
          <div class="empty-symbol">${icon("compass")}</div>
          <h2>还没有运行中的委托</h2>
          <p>创建委托后，AI 的筛选、核验和协商进展都会出现在这里。</p>
          <button class="primary-button" data-action="go-create">创建找房委托</button>
        </div>
      </section>`;
  }

  const result = state.result;
  const hasCandidates = result.candidates.length > 0;
  return `
    <section class="screen-enter">
      <div class="result-hero">
        <div class="eyebrow">委托仍在后台运行</div>
        <h1>${hasCandidates ? `AI 已替你挑出 ${result.candidates.length} 套` : "这一轮没有硬凑候选"}</h1>
        <p>${hasCandidates ? "以下信息已按你的需求重新整理，不是照搬出租方文案。" : "所有房源都触发了硬性冲突、预算边界或风控规则。"}</p>
        <div class="result-stats">
          <div class="result-stat"><strong>${result.scanned}</strong><span>本轮扫描</span></div>
          <div class="result-stat"><strong>${result.excludedCount}</strong><span>条件排除</span></div>
          <div class="result-stat"><strong>${result.quarantinedCount}</strong><span>风控隔离</span></div>
        </div>
      </div>

      <button class="audit-summary-button" data-action="open-audit">
        <span class="audit-icon">${icon("list")}</span>
        <span><strong>查看 AI 完整工作记录</strong><small>展示事实、报价和决策；不展示隐藏推理</small></span>
        ${icon("arrow")}
      </button>

      ${hasCandidates ? `
        <section class="section">
          <div class="section-header"><h2>交付给你的候选</h2><p>已去重 · 最多 3 套</p></div>
          ${result.candidates.map(candidateCard).join("")}
        </section>` : `
        <div class="empty-card">
          <div class="empty-symbol">${icon("shield")}</div>
          <h2>AI 没有放宽你的底线</h2>
          <p>你可以修改委托，或在测试台切换场景，观察不同冲突如何被处理。</p>
          <button class="secondary-button" data-action="edit-mandate">修改委托</button>
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
    <section class="screen-enter">
      <div class="detail-topbar">
        <button class="icon-button" data-action="back-root" aria-label="返回候选列表">${icon("back")}</button>
        <h1>候选详情</h1>
        <button class="icon-button" data-action="open-report" aria-label="举报此房源">${icon("report")}</button>
      </div>
      <div class="property-photo detail-photo tone-${listing.photoTone}">
        <span class="selection-badge">${candidate.selectionLabel} · ${candidate.score}% 匹配</span>
        <span class="photo-badge">模拟照片 · ${listing.photoLabel}</span>
      </div>
      <div class="detail-content">
        <div class="detail-title-row">
          <h2 class="detail-title">${listing.shortTitle}</h2>
          <div class="detail-rent">¥${candidate.agreedRent.toLocaleString("zh-CN")}</div>
        </div>
        <p class="candidate-meta"><span>${listing.station}步行 ${listing.walkMinutes} 分钟</span><span>预计通勤 ${listing.commuteMinutes} 分钟</span></p>

        <div class="agreement-ticket">
          <strong>双方 AI 已形成非约束性意向</strong>
          <p>${candidate.agreementLabel || `当前意向价 ¥${candidate.agreedRent.toLocaleString("zh-CN")}/月`}。进入人工确认前，不会开放真人聊天。</p>
        </div>

        <section class="section">
          <div class="section-header"><h2>为什么适合你</h2><p>${candidate.score}%</p></div>
          <ul class="plain-list positive">${candidate.reasons.map((reason) => `<li>${reason}</li>`).join("")}</ul>
        </section>

        <section class="section">
          <div class="section-header"><h2>先把缺点说清楚</h2><p>${candidate.caveats.length} 项</p></div>
          <ul class="plain-list warning">${candidate.caveats.map((reason) => `<li>${reason}</li>`).join("") || "<li>暂无已知冲突，仍需现场核验。</li>"}</ul>
        </section>

        <section class="section">
          <div class="section-header"><h2>每条信息从哪来</h2><p>可追溯</p></div>
          <div class="summary-card">
            ${candidate.provenance.map((item) => `
              <div class="fact-row">
                <span class="fact-label">${item.label}<br /><span class="source-badge ${sourceClass(item.source)}">${item.source}</span></span>
                <span class="fact-value">${item.value}</span>
              </div>`).join("")}
          </div>
        </section>

        <section class="section">
          <div class="section-header"><h2>双方 AI 怎么谈的</h2><p>可审计事件</p></div>
          <div class="timeline">
            ${candidate.negotiation.publicEvents.map((event) => `
              <div class="timeline-item">
                <span class="timeline-dot"></span>
                <div class="timeline-copy"><strong>${event.title}</strong><span>${event.detail}</span><small>${event.actor}</small></div>
              </div>`).join("")}
          </div>
          <div class="nonbinding-note">这里展示的是双方实际交换的事实、报价与条件，不展示模型的隐藏思维，也不会泄露对方的保留价或你的私密预算上限。</div>
        </section>

        <button class="primary-button button-full" data-action="confirm-candidate">愿意进一步确认</button>
        <button class="report-link" data-action="open-report">信息不实或怀疑中介？立即举报</button>
      </div>
    </section>`;
}

function auditPage() {
  const result = state.result;
  return `
    <section class="screen-enter">
      <div class="detail-topbar">
        <button class="icon-button" data-action="back-root" aria-label="返回进展">${icon("back")}</button>
        <h1>AI 工作记录</h1>
        <span></span>
      </div>
      <div class="progress-header">
        <div class="eyebrow">结构化事件日志</div>
        <h1 class="page-title">每一步都能追溯</h1>
        <p class="page-subtitle">你看到的是输入、输出、报价和规则命中，不是不可验证的“AI 内心独白”。</p>
      </div>
      <div class="audit-card">
        ${(result?.audit || []).map((event) => `
          <article class="audit-event">
            <header><h3>${event.title}</h3><span class="actor">${event.actor}</span></header>
            <p>${event.detail}</p>
          </article>`).join("") || "<p>暂无记录。</p>"}
      </div>
      ${result?.quarantinedCount ? `<div class="risk-banner"><strong>已自动隔离 ${result.quarantinedCount} 套风险房源。</strong><br />隔离后不再进入任何新匹配；客观证据确认中介伪装或收费后，将执行实名主体永久封禁。</div>` : ""}
      <section class="section">
        <div class="policy-card">
          <h3>${icon("eye")} 可见性边界</h3>
          <p>你能看到对方真实发出的报价与条件。你看不到对方私密底价；对方也看不到你的最高预算。最终结果必须由双方本人确认。</p>
        </div>
      </section>
    </section>`;
}

function supplyDraftScreen() {
  const draft = state.supplyDraft;
  return `
    <section class="screen-enter">
      <div class="hero">
        <div class="eyebrow">发布的不是广告，是可核验供给</div>
        <h1>先证明你有权出租。</h1>
        <p>只有房东本人直租和当前承租人个人转租能进入匹配。任何中介、代发或收费服务都不接受。</p>
      </div>

      <div class="risk-banner"><strong>零中介准入：</strong>中介费、服务费、信息费、带看费、签约费任一项大于 0，都无法发布。</div>

      <section class="section">
        <span class="field-label">你的发布角色</span>
        <div class="role-options">
          <button class="role-option" data-action="set-supply-role" data-value="landlord" aria-pressed="${draft.role === "landlord"}"><strong>房东本人</strong><small>产权人或共同产权人直接出租</small></button>
          <button class="role-option" data-action="set-supply-role" data-value="subletter" aria-pressed="${draft.role === "subletter"}"><strong>当前承租人</strong><small>本人在租合同内的个人转租</small></button>
        </div>
      </section>

      <section class="section">
        <div class="supply-card">
          <div class="field-group">
            <label for="supply-title">房源一句话</label>
            <input id="supply-title" class="text-field" data-input="supply-title" value="${escapeHtml(draft.title)}" />
          </div>
          <div class="field-group">
            <label for="supply-address">完整地址 <span class="source-badge verified">仅平台核验可见</span></label>
            <textarea id="supply-address" class="text-field" data-input="supply-address">${escapeHtml(draft.address)}</textarea>
          </div>
          <div class="field-group">
            <label for="supply-rent">挂牌月租</label>
            <input id="supply-rent" class="text-field" inputmode="numeric" data-input="supply-rent" value="${draft.listedRent}" />
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-header"><h2>现场随机拍摄</h2><p>防盗图与过期</p></div>
        <div class="photo-challenge">
          <div class="photo-tile done">${icon("camera")}卧室 + 指定手势</div>
          <div class="photo-tile done">${icon("camera")}窗外 + 当日码</div>
          <div class="photo-tile done">${icon("camera")}厨房 + 水表</div>
        </div>
      </section>

      <section class="section">
        <div class="section-header"><h2>费用必须逐项写清</h2><p>不可打包模糊</p></div>
        <div class="summary-card">
          <div class="fee-row"><span class="fee-label">租金</span><span class="fee-value">¥${draft.listedRent}/月</span></div>
          <div class="fee-row"><span class="fee-label">押金</span><span class="fee-value">¥${draft.fees.deposit}</span></div>
          <div class="fee-row"><span class="fee-label">水电</span><span class="fee-value">${draft.fees.utilities}</span></div>
          <div class="fee-row"><span class="fee-label">中介 / 服务费</span><span class="fee-value">¥0</span></div>
        </div>
      </section>

      <div class="sticky-action">
        <button class="primary-button button-full" data-action="scan-supply">让 AI 检查完整度 ${icon("spark")}</button>
      </div>
    </section>`;
}

function supplyReviewScreen() {
  const validation = state.supplyValidation || validateSupplyDraft(state.supplyDraft);
  return `
    <section class="screen-enter">
      <div class="progress-header">
        <div class="step-kicker"><span>供给核验</span><span>2 / 3</span></div>
        <div class="step-track"><span style="width:66%"></span></div>
        <h1 class="page-title">AI 已整理成标准房源</h1>
        <p class="page-subtitle">出租方原文不会直接展示给租户；系统会按每位租户的委托重新组织事实。</p>
      </div>

      <div class="verification-grid">
        <div class="verification-item">身份一致<small>实名与活体核验</small></div>
        <div class="verification-item">角色一致<small>${state.supplyDraft.role === "landlord" ? "产权人本人" : "现租客本人"}</small></div>
        <div class="verification-item">权利一致<small>产权或在租合同</small></div>
        <div class="verification-item">现场一致<small>随机拍摄挑战</small></div>
      </div>

      <section class="section">
        <div class="summary-card">
          <div class="summary-row"><span class="fact-label">可入住</span><span class="fact-value">2026 年 8 月 29 日</span></div>
          <div class="summary-row"><span class="fact-label">挂牌租金</span><span class="fact-value">¥${state.supplyDraft.listedRent}/月</span></div>
          <div class="summary-row"><span class="fact-label">合租情况</span><span class="fact-value">2 位女生室友</span></div>
          <div class="summary-row"><span class="fact-label">基础设施</span><span class="fact-value">厨房、滚筒、电梯</span></div>
          <div class="summary-row"><span class="fact-label">额外费用</span><span class="fact-value">无</span></div>
        </div>
      </section>

      <div class="private-box">
        <h3>${icon("lock")} 出租方私密协商授权</h3>
        <ul>
          <li>挂牌 ¥3,200；AI 可直接接受 ¥3,100。</li>
          <li>租满 12 个月且 9 月 1 日前起租，可接受 ¥3,000。</li>
          <li>更低报价必须回来询问本人。</li>
        </ul>
      </div>

      ${validation.errors.length ? `<div class="risk-banner">${validation.errors.join("；")}</div>` : ""}
      <label class="consent-row">
        <input type="checkbox" data-action="toggle-supply-pledge" ${state.supplyPledge ? "checked" : ""} />
        <span>我确认是房东本人或当前承租人，不收取中介费、服务费、信息费、带看费或签约费；故意虚假申报将被实名级永久封禁。</span>
      </label>

      <div class="sticky-action">
        <button class="primary-button button-full" data-action="publish-supply" ${state.supplyPledge && validation.valid ? "" : "disabled"}>通过核验并进入供给池</button>
      </div>
    </section>`;
}

function supplyPublishedScreen() {
  return `
    <section class="screen-enter">
      <div class="success-seal">${icon("check")}</div>
      <div class="center-copy">
        <h1>房源已进入供给池</h1>
        <p>租户不会直接给你留言。只有满足硬条件的找房 AI 才能发起结构化询问和报价。</p>
      </div>
      <section class="section">
        <div class="summary-card">
          <div class="fact-row"><span class="fact-label">房源状态</span><span class="fact-value">等待匹配</span></div>
          <div class="fact-row"><span class="fact-label">角色徽章</span><span class="fact-value">个人转租 · 已核验</span></div>
          <div class="fact-row"><span class="fact-label">现场信息有效期</span><span class="fact-value">还剩 7 天</span></div>
          <div class="fact-row"><span class="fact-label">真人聊天</span><span class="fact-value">双方确认后开放</span></div>
        </div>
      </section>
      <section class="section">
        <div class="policy-card">
          <h3>接下来你不用守着消息</h3>
          <p>出租 AI 会回答已声明事实，并在授权范围内报价。超出授权、材料变化或高风险问题才会回来找你。</p>
        </div>
      </section>
      <button class="secondary-button button-full" data-action="reset-supply">再模拟一次发布</button>
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
          <h2>房源还没进入供给池</h2>
          <p>完成角色、出租权、现场和费用核验后，AI 才能代你接收匹配请求。</p>
          <button class="primary-button" data-action="go-supply">去发布房源</button>
        </div>
      </section>`;
  }
  return `
    <section class="screen-enter">
      <div class="result-hero">
        <div class="eyebrow">出租 AI 正在工作</div>
        <h1>收到 7 份委托，2 份值得继续</h1>
        <p>数字来自当前模拟场景：其余委托因预算、时间或室友条件冲突被自动拒绝。</p>
        <div class="result-stats">
          <div class="result-stat"><strong>7</strong><span>进入初筛</span></div>
          <div class="result-stat"><strong>5</strong><span>硬条件冲突</span></div>
          <div class="result-stat"><strong>2</strong><span>正在协商</span></div>
        </div>
      </div>
      <div class="audit-card">
        <article class="audit-event"><header><h3>租户 A · 报价 ¥3,000</h3><span class="actor">条件命中</span></header><p>12 个月租期，8 月 29 日起租；已按你的授权有条件接受。</p></article>
        <article class="audit-event"><header><h3>租户 B · 询问是否可养猫</h3><span class="actor">等待本人</span></header><p>你的房源资料没有宠物规则，AI 不会自行承诺。</p></article>
        <article class="audit-event"><header><h3>租户 C · 最高 ¥2,800</h3><span class="actor">自动拒绝</span></header><p>低于私密授权范围，没有继续暴露你的条件。</p></article>
      </div>
    </section>`;
}

function profileScreen() {
  return `
    <section class="screen-enter">
      <div class="hero">
        <div class="eyebrow">信任不是一个总分</div>
        <h1>四件事，分别核验。</h1>
        <p>身份、发布角色、出租权和现场真实性各自有来源。任何一项失效都不会继续沿用旧徽章。</p>
      </div>
      <div class="verification-grid">
        <div class="verification-item">身份<small>实名 + 活体</small></div>
        <div class="verification-item">角色<small>房东 / 当前承租人</small></div>
        <div class="verification-item">出租权<small>产权 / 在租合同</small></div>
        <div class="verification-item">现场<small>随机拍摄 + 时效</small></div>
      </div>
      <section class="section">
        <div class="policy-card">
          <h3>对故意说假话，零次机会</h3>
          <p>冒充个人、索取中介或服务费、伪造材料、盗图、绕过封禁：客观证据确认后，实名主体永久禁止再次发布。</p>
        </div>
      </section>
      <section class="section">
        <div class="section-header"><h2>原型设置</h2><p>仅本地保存</p></div>
        <div class="summary-card">
          <div class="setting-row"><span class="fact-label">模拟测试台</span><button data-action="open-lab">打开</button></div>
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
          <div><h2 id="lab-title">模拟测试台</h2><p>切换边界场景，直接观察产品如何处理；不调用真实 AI。</p></div>
          <button class="icon-button" data-action="close-sheet" aria-label="关闭">${icon("close")}</button>
        </header>

        <div class="scenario-list">
          ${labScenarios.map((scenario, index) => `
            <button class="scenario-button" data-action="load-scenario" data-value="${scenario.id}" aria-current="${state.activeScenario === scenario.id}">
              <span class="scenario-index">0${index + 1}</span>
              <span><strong>${scenario.name}</strong><small>${scenario.description}</small></span>
              ${icon("arrow")}
            </button>`).join("")}
        </div>

        <section class="section">
          <div class="section-header"><h2>视觉方向</h2><p>三种可比较方案</p></div>
          <div class="theme-toggle">
            <button data-action="set-theme" data-value="ledger" aria-pressed="${state.theme === "ledger"}">安心账本</button>
            <button data-action="set-theme" data-value="neighbor" aria-pressed="${state.theme === "neighbor"}">邻里暖光</button>
            <button data-action="set-theme" data-value="precision" aria-pressed="${state.theme === "precision"}">效率模式</button>
          </div>
        </section>

        <section class="section">
          <div class="section-header"><h2>信息密度</h2><p>用于可读性测试</p></div>
          <div class="density-toggle">
            <button data-action="set-density" data-value="compact" aria-pressed="${state.density === "compact"}">紧凑</button>
            <button data-action="set-density" data-value="comfortable" aria-pressed="${state.density === "comfortable"}">舒适</button>
            <button data-action="set-density" data-value="spacious" aria-pressed="${state.density === "spacious"}">宽松</button>
          </div>
        </section>

        <section class="section">
          <div class="section-header"><h2>规则回归</h2><p>${state.regression ? `${passed}/${state.regression.length} 通过` : "13 个断言"}</p></div>
          ${state.regression ? `<div class="regression-list">${state.regression.map((item) => `
            <div class="regression-row"><span>${item.passed ? icon("check") : icon("close")}</span><span>${item.name}</span><span class="${item.passed ? "pass" : "fail"}">${item.passed ? "PASS" : "FAIL"}</span></div>`).join("")}</div>` : `<button class="secondary-button button-full" data-action="run-regression">运行全部模拟测试</button>`}
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
          <div><h2 id="report-title">举报房源</h2><p>提交后立即停止进入新匹配；不可逆封禁需要客观证据确认。</p></div>
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
          <span>模拟附上站内索取费用的完整对话（用于测试“客观证据命中”分支）</span>
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
          <div><h2 id="report-result-title">举报处置结果</h2><p>模拟风控决定已写入审计事件。</p></div>
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
  if (shouldResetScroll) {
    const main = app.querySelector("#app-main");
    if (main) main.scrollTop = 0;
  }
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
    draftText: exampleDemands.commute,
    answers: { roommate: "female", bathroom: "preferred", elevator: "preferred", utilities: "residential" },
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

app.addEventListener("input", (event) => {
  const input = event.target.closest("[data-input]");
  if (!input) return;
  if (input.dataset.input === "draft-text") state.draftText = input.value;
  if (input.dataset.input === "supply-title") state.supplyDraft.title = input.value;
  if (input.dataset.input === "supply-address") state.supplyDraft.address = input.value;
  if (input.dataset.input === "supply-rent") {
    state.supplyDraft.listedRent = Number(input.value || 0);
    state.supplyDraft.fees.rent = Number(input.value || 0);
  }
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
    case "sample-demand":
      state.draftText = exampleDemands[value];
      render();
      break;
    case "simulate-voice":
      state.listening = true;
      render();
      setTimeout(() => {
        state.listening = false;
        state.draftText = exampleDemands.commute;
        showToast("已转成文字，可继续修改");
      }, 700);
      break;
    case "start-intake":
      if (!state.draftText.trim()) {
        showToast("先说一点你的需求");
      } else {
        state.renterStage = "clarify";
        render();
      }
      break;
    case "set-answer":
      state.answers[target.dataset.key] = value;
      render();
      break;
    case "review-mandate":
      state.renterStage = "review";
      render();
      break;
    case "toggle-consent":
      state.consent = target.checked;
      render();
      break;
    case "publish-mandate": {
      if (!state.consent) {
        showToast("请先确认 AI 的授权边界");
        break;
      }
      const { result } = runLabScenario(state.activeScenario, mandateFromAnswers());
      state.result = result;
      state.tab = "progress";
      state.page = "root";
      showToast(result.candidates.length ? `AI 已交付 ${result.candidates.length} 套候选` : "本轮没有合适候选");
      break;
    }
    case "go-create":
      state.tab = "mandate";
      state.renterStage = "input";
      render();
      break;
    case "edit-mandate":
      state.tab = "mandate";
      state.renterStage = "clarify";
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
      showToast("已请求双方本人确认，真人聊天仍未开放");
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
      render();
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
      render();
      break;
    case "publish-supply":
      if (!state.supplyPledge) {
        showToast("请先签署零中介承诺");
      } else {
        state.supplyStage = "published";
        showToast("房源已进入模拟供给池");
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
      showToast("流程已重置，视觉设置保留");
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
