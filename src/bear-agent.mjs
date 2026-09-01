/**
 * 小熊分身：分层骨架 + 分部件动画。
 *
 * 素材来自把原始 3D 渲染整图按连通域切开（脚本见提交记录），
 * 切分经逐像素校验为无损：五层合成回原图差异 0/1128786。
 * 两只爪子与两只脚在原图里本就是独立连通域、不与身体重叠，
 * 因此摆动它们不会露出需要修补的空洞 —— 这是分层方案可行的前提。
 *
 * 相比整图只能整体浮动，现在可以做：头部歪斜、帽子的跟随延迟（次级动作）、
 * 手臂自肩部摆动、以及用毛色采样合成的眼皮做眨眼。
 */

const LAYER_BASE = new URL("../assets/bear/", import.meta.url);

// 各层在 898x1257 画布中的位置（百分比，随容器等比缩放）。
// 数值由切分脚本导出的 layers.json 换算而来。
const LAYERS = [
  { part: "body", src: "body.webp", left: 0, top: 0, width: 100, height: 100 },
  { part: "arm-left", src: "arm-left.webp", left: 9.354, top: 74.543, width: 10.579, height: 8.831 },
  { part: "arm-right", src: "arm-right.webp", left: 80.067, top: 74.463, width: 10.579, height: 8.91 },
  { part: "head", src: "head.webp", left: 0.334, top: 8.592, width: 99.332, height: 57.836 },
  { part: "eyes-closed", src: "eyes-closed.webp", left: 25.947, top: 41.368, width: 50.891, height: 9.626 },
  { part: "hat", src: "hat.webp", left: 28.731, top: 0.239, width: 42.094, height: 12.411 }
];

function animationFinished(animation) {
  return animation.finished.catch(() => undefined);
}

function animatePart(element, keyframes, options) {
  if (!element || !element.animate) return Promise.resolve();
  return animationFinished(element.animate(keyframes, { fill: "both", ...options }));
}

function layerMarkup({ part, src, left, top, width, height }) {
  const style = `left:${left}%;top:${top}%;width:${width}%;height:${height}%`;
  const priority = part === "head" || part === "body" ? "" : ' loading="lazy"';
  return `<img class="bear-layer" data-part="${part}" src="${new URL(src, LAYER_BASE).href}" style="${style}" alt="" aria-hidden="true" decoding="async"${priority} />`;
}

export function bearAgentMarkup({ id, mode = "idle", label = "AI 小熊分身", compact = false } = {}) {
  const safeId = id || `bear-${Math.random().toString(36).slice(2)}`;
  return `<div class="bear-agent ${compact ? "is-compact" : ""}" data-bear-agent data-bear-id="${safeId}" data-mode="${mode}" role="img" aria-label="${label}">
    <div class="bear-agent-stage">
      <div class="bear-rig" data-bear-rig>${LAYERS.map(layerMarkup).join("")}</div>
      <span class="bear-motion-trail" aria-hidden="true"></span>
    </div>
  </div>`;
}

function setHover(host, isHovered) {
  if (!host || host.dataset.launching === "true") return;
  host.classList.toggle("is-hovered", isHovered);
}

function bindHoverTargets(host) {
  if (host.dataset.hoverBound === "true") return;
  host.dataset.hoverBound = "true";
  host.addEventListener("pointerenter", () => setHover(host, true));
  host.addEventListener("pointerleave", () => setHover(host, false));

  const id = host.dataset.bearId;
  document.querySelectorAll(`[data-bear-hover-for="${id}"]`).forEach((target) => {
    target.addEventListener("pointerenter", () => setHover(host, true));
    target.addEventListener("pointerleave", () => setHover(host, false));
    target.addEventListener("focus", () => setHover(host, true));
    target.addEventListener("blur", () => setHover(host, false));
  });
}

/**
 * 眨眼由脚本驱动而非纯 CSS：真实眨眼的间隔是不规则的，
 * 固定周期的 CSS 动画会让角色显得机械。
 */
function startBlinking(host) {
  if (host.dataset.blinking === "true") return;
  const lid = host.querySelector('[data-part="eyes-closed"]');
  if (!lid) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  host.dataset.blinking = "true";

  const schedule = () => {
    // 2.4~6.8s 的随机间隔；偶尔连眨两次，更接近真人
    const delay = 2400 + Math.random() * 4400;
    host.__blinkTimer = window.setTimeout(async () => {
      if (!host.isConnected) return;
      const double = Math.random() < 0.22;
      await animatePart(lid, [{ opacity: 0 }, { opacity: 1 }, { opacity: 1 }, { opacity: 0 }], {
        duration: 190,
        easing: "ease-in-out"
      });
      if (double) {
        await new Promise((resolve) => window.setTimeout(resolve, 110));
        await animatePart(lid, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 150 });
      }
      schedule();
    }, delay);
  };
  schedule();
}

export async function mountBearAgents(root = document) {
  const hosts = [...root.querySelectorAll("[data-bear-agent]")];
  hosts.forEach((host) => {
    bindHoverTargets(host);
    startBlinking(host);
  });
  return hosts;
}

export async function launchBearAgent(host) {
  if (!host || host.dataset.launching === "true") return;
  await mountBearAgents(host.parentElement || document);

  host.dataset.launching = "true";
  host.dataset.mode = "receive";
  host.classList.remove("is-hovered");
  host.classList.add("is-launching");

  const stage = host.querySelector(".bear-agent-stage");
  const part = (name) => host.querySelector(`[data-part="${name}"]`);
  const rig = host.querySelector("[data-bear-rig]");
  const head = part("head");
  const hat = part("hat");
  const armL = part("arm-left");
  const armR = part("arm-right");
  const lid = part("eyes-closed");

  // 接到任务：整体轻弹 + 头部上抬，帽子延迟跟随（次级动作让弹跳有重量感）
  await Promise.all([
    animatePart(rig, [
      { transform: "translateY(0) scale(1)" },
      { transform: "translateY(-6px) scale(1.03)", offset: 0.46 },
      { transform: "translateY(0) scale(1)" }
    ], { duration: 360, easing: "cubic-bezier(.2,.75,.3,1)" }),
    animatePart(head, [
      { transform: "translateY(0) rotate(0deg)" },
      { transform: "translateY(-4px) rotate(-1.5deg)", offset: 0.5 },
      { transform: "translateY(0) rotate(0deg)" }
    ], { duration: 380, easing: "ease-out" }),
    animatePart(hat, [
      { transform: "translateY(0) rotate(0deg)" },
      { transform: "translateY(-6px) rotate(-3deg)", offset: 0.58 },
      { transform: "translateY(0) rotate(0deg)" }
    ], { duration: 430, easing: "ease-out" }),
    animatePart(armL, [{ transform: "rotate(0deg)" }, { transform: "rotate(-16deg)" }, { transform: "rotate(0deg)" }], { duration: 380 }),
    animatePart(armR, [{ transform: "rotate(0deg)" }, { transform: "rotate(16deg)" }, { transform: "rotate(0deg)" }], { duration: 380 })
  ]);

  // 蓄力：下沉压缩，手臂后摆，闭眼（用力的表情）
  host.dataset.mode = "prepare";
  await Promise.all([
    animatePart(rig, [
      { transform: "translateY(0) scale(1,1)" },
      { transform: "translateY(11px) scale(1.04,.93)" }
    ], { duration: 470, easing: "cubic-bezier(.3,.05,.3,1)" }),
    animatePart(hat, [{ transform: "translateY(0) rotate(0deg)" }, { transform: "translateY(5px) rotate(-2deg)" }], { duration: 470, easing: "ease-in" }),
    animatePart(armL, [{ transform: "rotate(0deg)" }, { transform: "rotate(24deg)" }], { duration: 470, easing: "ease-in" }),
    animatePart(armR, [{ transform: "rotate(0deg)" }, { transform: "rotate(-24deg)" }], { duration: 470, easing: "ease-in" }),
    animatePart(lid, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-in" })
  ]);

  host.dataset.mode = "launch";
  host.classList.add("show-trail");
  await animatePart(stage, [
    { transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)", opacity: 1 },
    { transform: "translate3d(8px, -10px, 0) rotate(1deg) scale(1.02)", opacity: 1, offset: 0.12 },
    { transform: "translate3d(680px, -440px, 0) rotate(13deg) scale(.7)", opacity: 0 }
  ], { duration: 900, easing: "cubic-bezier(.52,.02,.92,.5)" });

  host.dispatchEvent(new CustomEvent("bearlaunchcomplete", { bubbles: true }));
  return true;
}

export const bearAgentMachineSpec = Object.freeze({
  name: "BearAgentMachine",
  states: ["Idle", "Hover", "ReceiveTask", "PrepareLaunch", "Launch", "Searching", "Success"],
  inputs: { launch: "trigger", hover: "boolean", searching: "boolean", success: "trigger" },
  completionSignal: "launchComplete"
});
