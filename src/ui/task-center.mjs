import { escapeAttribute, escapeText } from "./safe-markup.mjs";

const STATUS_LABELS = {
  active: "持续匹配中",
  paused: "已暂停",
  closed: "已关闭",
  expired: "已到期"
};

function dateLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai"
  }).format(date);
}

function metric(label, value, tone = "") {
  return `<span class="task-card-metric ${tone}"><b>${escapeText(value ?? 0)}</b>${escapeText(label)}</span>`;
}

function taskCard(task, activeTaskId) {
  const status = STATUS_LABELS[task.status] || "状态未知";
  const statusAction = task.status === "active"
    ? `<span class="task-card-actions"><button class="task-renew-action" data-action="renew-server-task" data-id="${escapeAttribute(task.id)}">续期</button><button class="task-status-action" data-action="set-task-status" data-id="${escapeAttribute(task.id)}" data-value="paused">暂停</button></span>`
    : task.status === "paused"
      ? `<span class="task-card-actions"><button class="task-renew-action" data-action="renew-server-task" data-id="${escapeAttribute(task.id)}">续期</button><button class="task-status-action is-resume" data-action="set-task-status" data-id="${escapeAttribute(task.id)}" data-value="active">恢复</button></span>`
      : task.status === "expired"
        ? `<span class="task-card-actions"><span class="task-readonly">只读</span><button class="task-renew-action" data-action="clone-task" data-id="${escapeAttribute(task.id)}">复制新建</button></span>`
        : `<span class="task-readonly">只读</span>`;
  const lastMatch = task.lastMatchAt ? `上次匹配 ${dateLabel(task.lastMatchAt)}` : "等待首次匹配";
  return `<article class="task-center-card ${task.id === activeTaskId ? "is-selected" : ""}" data-task-card="${escapeAttribute(task.id)}">
    <button class="task-card-main" data-action="open-task" data-id="${escapeAttribute(task.id)}">
      <span class="task-card-kicker"><i class="task-kind-dot ${escapeAttribute(task.kind)}"></i>${task.kind === "renter" ? "找房需求" : "出租房源"}<em>${escapeText(status)}</em></span>
      <strong>${escapeText(task.label || (task.kind === "renter" ? "未命名找房需求" : "未命名出租房源"))}</strong>
      <span class="task-card-metrics">
        ${metric("候选", task.candidateCount ?? task.suitable)}
        ${metric("待澄清", task.clarificationCount, task.clarificationCount ? "is-attention" : "")}
        ${metric("待我确认", task.myConfirmationCount, task.myConfirmationCount ? "is-attention" : "")}
        ${metric("等对方", task.otherConfirmationCount)}
      </span>
    </button>
    <footer><span>${escapeText(lastMatch)} · ${task.expiresAt ? `${dateLabel(task.expiresAt)} 到期` : "长期有效"}</span>${statusAction}</footer>
  </article>`;
}

export function renderTaskCenter({ tasks = [], activeTaskId = null, loading = false, error = "", notice = "" } = {}) {
  const status = error
    ? `<div class="task-center-notice is-error" role="alert">${escapeText(error)}</div>`
    : notice ? `<div class="task-center-notice" role="alert">${escapeText(notice)}</div>` : "";
  const body = loading && !tasks.length
    ? '<div class="task-center-loading" role="status">正在读取任务…</div>'
    : tasks.length
      ? `<div class="task-center-list">${tasks.map((task) => taskCard(task, activeTaskId)).join("")}</div>`
      : '<div class="task-center-empty"><b>还没有任务</b><p>把找房需求或房源交给 AI 分身，它会持续替你筛选。</p><button data-action="task-center-create">新建任务</button></div>';
  return `<section class="task-center-screen" aria-labelledby="task-center-title">
    <header class="task-center-header"><button data-action="close-task-center" aria-label="返回">←</button><div><span>持续匹配控制台</span><h1 id="task-center-title">我的任务</h1></div><button data-action="task-center-create" aria-label="新建任务">＋</button></header>
    ${status}${body}
  </section>`;
}

export function bindTaskCenterActions(root, handlers = {}) {
  const listener = (event) => {
    const target = event.target.closest?.("[data-action]");
    if (!target || !root.contains(target)) return;
    const handler = handlers[target.dataset.action];
    if (handler) handler({ id: target.dataset.id, value: target.dataset.value, target, event });
  };
  root.addEventListener("click", listener);
  return () => root.removeEventListener("click", listener);
}
