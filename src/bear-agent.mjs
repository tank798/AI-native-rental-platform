const bearVisualUrl = new URL("../assets/bear-agent-anchor.png", import.meta.url);
const bearRigUrl = new URL("../assets/bear-agent.svg", import.meta.url);

let bearSvgPromise;

function loadBearSvg() {
  if (!bearSvgPromise) {
    bearSvgPromise = fetch(bearRigUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Bear SVG failed: ${response.status}`);
        return response.text();
      });
  }
  return bearSvgPromise;
}

function animationFinished(animation) {
  return animation.finished.catch(() => undefined);
}

function animatePart(element, keyframes, options) {
  if (!element || !element.animate) return Promise.resolve();
  return animationFinished(element.animate(keyframes, { fill: "both", ...options }));
}

export function bearAgentMarkup({ id, mode = "idle", label = "AI 小熊分身", compact = false } = {}) {
  const safeId = id || `bear-${Math.random().toString(36).slice(2)}`;
  return `<div class="bear-agent ${compact ? "is-compact" : ""}" data-bear-agent data-bear-id="${safeId}" data-mode="${mode}" role="img" aria-label="${label}">
    <svg class="bear-alpha-filter" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id="${safeId}-alpha-clean" x="-18%" y="-18%" width="136%" height="136%" color-interpolation-filters="sRGB">
        <feComponentTransfer>
          <feFuncA type="linear" slope="1.3" intercept="-0.16" />
        </feComponentTransfer>
      </filter>
    </svg>
    <div class="bear-agent-stage">
      <img class="bear-agent-render" src="${bearVisualUrl.href}" width="1190" height="1322" alt="" aria-hidden="true" style="filter:url(#${safeId}-alpha-clean) drop-shadow(0 11px 15px rgba(17,17,20,.075))" />
      <div class="bear-agent-rig" data-bear-svg aria-hidden="true"></div>
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

export async function mountBearAgents(root = document) {
  const hosts = [...root.querySelectorAll("[data-bear-agent]")];
  if (!hosts.length) return [];

  let svg;
  try {
    svg = await loadBearSvg();
  } catch {
    svg = "";
  }

  hosts.forEach((host) => {
    const target = host.querySelector("[data-bear-svg]");
    if (target && !target.firstElementChild) target.innerHTML = svg;
    bindHoverTargets(host);
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
  const visual = host.querySelector(".bear-agent-render");
  const svg = host.querySelector("svg");
  const root = svg?.querySelector("#BearAgent");
  const head = svg?.querySelector("#head");
  const hat = svg?.querySelector("#hat");
  const leftEye = svg?.querySelector("#leftEye");
  const rightEye = svg?.querySelector("#rightEye");
  const leftArm = svg?.querySelector("#leftArm");
  const rightArm = svg?.querySelector("#rightArm");
  const leftLeg = svg?.querySelector("#leftLeg");
  const rightLeg = svg?.querySelector("#rightLeg");

  await Promise.all([
    animatePart(visual, [
      { transform: "translateY(0) scale(1)" },
      { transform: "translateY(-5px) scale(1.025)", offset: 0.46 },
      { transform: "translateY(0) scale(1)" }
    ], { duration: 340, easing: "cubic-bezier(.2,.75,.3,1)" }),
    animatePart(root, [
      { transform: "translateY(0) scale(1)" },
      { transform: "translateY(-5px) scale(1.025)", offset: 0.46 },
      { transform: "translateY(0) scale(1)" }
    ], { duration: 340, easing: "cubic-bezier(.2,.75,.3,1)" }),
    animatePart(head, [
      { transform: "translateY(0)" },
      { transform: "translateY(-3px)" },
      { transform: "translateY(0)" }
    ], { duration: 340, easing: "ease-out" }),
    animatePart(leftEye, [{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: 340 }),
    animatePart(rightEye, [{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: 340 })
  ]);

  host.dataset.mode = "prepare";
  await Promise.all([
    animatePart(visual, [
      { transform: "translateY(0) scale(1,1)" },
      { transform: "translateY(10px) scale(1.03,.94)" }
    ], { duration: 470, easing: "cubic-bezier(.3,.05,.3,1)" }),
    animatePart(root, [
      { transform: "translateY(0) scale(1,1)" },
      { transform: "translateY(10px) scale(1.03,.94)" }
    ], { duration: 470, easing: "cubic-bezier(.3,.05,.3,1)" }),
    animatePart(hat, [{ transform: "translateY(0)" }, { transform: "translateY(4px) rotate(-1deg)" }], { duration: 470, easing: "ease-in" }),
    animatePart(leftArm, [{ transform: "rotate(0deg)" }, { transform: "rotate(9deg) translateY(2px)" }], { duration: 470, easing: "ease-in" }),
    animatePart(rightArm, [{ transform: "rotate(0deg)" }, { transform: "rotate(-9deg) translateY(2px)" }], { duration: 470, easing: "ease-in" }),
    animatePart(leftLeg, [{ transform: "scaleY(1)" }, { transform: "scaleY(.82)" }], { duration: 470, easing: "ease-in" }),
    animatePart(rightLeg, [{ transform: "scaleY(1)" }, { transform: "scaleY(.82)" }], { duration: 470, easing: "ease-in" })
  ]);

  host.dataset.mode = "launch";
  host.classList.add("show-trail");
  await animatePart(stage, [
    { transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)", opacity: 1 },
    { transform: "translate3d(8px, -10px, 0) rotate(1deg) scale(1.02)", opacity: 1, offset: .12 },
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
