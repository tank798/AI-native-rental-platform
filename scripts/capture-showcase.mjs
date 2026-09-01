/**
 * 重新生成 README 中的界面展示截图。
 *
 * 这些图是仓库首页的"门面"，界面改动后必须一起更新，否则 README 展示的是旧 UI。
 * 用法：
 *   1. 另起一个终端：MARKET_MODE=demo PORT=4173 npm start
 *   2. node scripts/capture-showcase.mjs [baseUrl]
 *
 * 受限网络下可用系统 Chrome：
 *   PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/google-chrome-stable node scripts/capture-showcase.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE = process.argv[2] || process.env.SHOWCASE_BASE_URL || "http://127.0.0.1:4173";
const OUT = path.resolve("output/playwright");
const EXECUTABLE = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
const ADMIN_REVIEW_TOKEN = process.env.SHOWCASE_ADMIN_REVIEW_TOKEN || "readme-showcase-only";
const EVIDENCE_FIXTURE = path.resolve("assets/room-sunlit.jpg");

const RENTER_TEXT = "静安寺附近，预算 3000 到 3500，9 月 3 日入住，女生合租，租 12 个月，通勤 35 分钟，需要厨房和洗衣机";
const SUPPLY_TEXT = "当前租客个人转租，静安寺站，月租3200元，最低3000元，9月3日入住，至少租3个月，整租，15平，9/18层，有厨房、洗衣机和电梯，朝南，0中介费0服务费";

async function main() {
  const { chromium } = await import("playwright");
  const sharp = (await import("sharp")).default;
  await fs.mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  // README 使用紧凑的移动视口，避免把整张长页面原样塞进仓库首页。
  // 需要完整页面时仍可直接用 Playwright 测试或浏览器手工查看。
  const context = await browser.newContext({ viewport: { width: 414, height: 760 }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  const shot = async (name, { selector, padding = 0 } = {}) => {
    // 冻结动画，保证同一界面每次产出一致的图，便于 diff 审阅
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none !important;transition:none !important}" });
    if (selector) {
      const target = page.locator(selector).first();
      await target.waitFor({ state: "visible", timeout: 10_000 });
      if (padding) {
        // locator.screenshot 能完整捕获滚动容器内的元素，但会把父级留白裁掉。
        // 先捕获真实元素，再在图片边缘补回留白，避免改变页面布局或裁掉滚动内容。
        const buffer = await target.screenshot();
        await sharp(buffer)
          .extend({ top: padding, bottom: padding, left: padding, right: padding, background: "#fff" })
          .png()
          .toFile(path.join(OUT, `${name}.png`));
      } else {
        await target.screenshot({ path: path.join(OUT, `${name}.png`) });
      }
    } else {
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    }
    process.stdout.write(`  ${name}\n`);
  };

  const clickIfPresent = async (selector, timeout = 2500) => {
    const locator = page.locator(selector).first();
    if (await locator.count() === 0) return false;
    try {
      await locator.click({ timeout });
      return true;
    } catch {
      return false;
    }
  };

  console.log("生成展示截图：");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await shot("01-home");

  // 租客链路
  await page.locator("textarea").first().fill(RENTER_TEXT);
  const intake = page.waitForResponse(
    (r) => r.url().includes("/api/intake/renter") && r.request().method() === "POST",
    { timeout: 120_000 }
  );
  await page.locator('[data-action="home-intake"]').first().click();
  await intake;
  await page.waitForTimeout(1400);
  await shot("02-renter-ai-intake");

  await clickIfPresent('[data-action="confirm-location"], button:has-text("确认需求")');
  await page.waitForTimeout(1200);
  await shot("03-renter-task-review");

  for (const box of await page.locator('input[type="checkbox"]').all()) {
    await box.check().catch(() => {});
  }
  await clickIfPresent('[data-action="publish-mandate"]');
  // 服务端会直接返回首轮结果，不伪造一段进度动画。先等真实候选到达，
  // 再回首页拍摄仍在运行的任务状态。
  await page.locator('[data-action="open-candidate"]').first()
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-action="switch-tab"][data-value="match"]').click();
  await page.locator(".agent-status").filter({ hasText: "仍在持续找房" }).waitFor({ state: "visible", timeout: 10_000 });
  await shot("04-continuous-matching", { selector: ".match-home" });
  await page.locator('[data-action="switch-tab"][data-value="results"]').click();
  await page.waitForTimeout(800);
  await shot("05-renter-results", { selector: ".results-screen" });

  if (await clickIfPresent('[data-action="open-candidate"]')) {
    await page.waitForTimeout(1500);
    await shot("06-candidate-detail");
    // 协商记录位于详情页下半部分。滚动容器是 #app-main（.screen-scroll），
    // 不是 window —— 先把完整协商卡片滚进视口，再拍一张带状态栏和标题的完整页面图。
    await page.locator(".agent-dialogue-card").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await shot("07-agent-negotiation");
    await clickIfPresent('[data-action="back-match-detail"]');
    await page.waitForTimeout(700);
  }

  // 出租链路。已建过任务后首页不再有"有房要出租"入口，
  // 需先打开新建面板，再点面板里的"我要出租"。
  if (!(await clickIfPresent('.home-supply-entry'))) {
    await clickIfPresent('[data-action="open-create"]');
    await page.waitForTimeout(700);
    await clickIfPresent('[data-action="create-supply"]');
  }
  await page.waitForTimeout(1100);
  const supplyInput = page.locator('[data-input="supply-text"]');
  if (await supplyInput.count()) {
    await supplyInput.first().fill(SUPPLY_TEXT);
    // 等接口真正返回，而不是猜一个固定时长：真实模型调用可能数秒到数十秒，
    // 固定等待会把 08/09 都截在"AI 整理中"的加载态。
    const supplyIntake = page.waitForResponse(
      (r) => r.url().includes("/api/intake/supply") && r.request().method() === "POST",
      { timeout: 120_000 }
    );
    await supplyInput.first().press("Enter");
    await supplyIntake.catch(() => {});
    await page.locator('[data-action="scan-supply"]').first()
      .waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    // 地址与租期是发布硬条件。模型若没有稳定抽出，截图脚本显式补齐，
    // 避免把模型解析波动误当成界面流程成功。
    await page.locator('[data-input="supply-address"]').fill("上海市静安区南阳路 100 号");
    await page.locator('[data-input="supply-lease"]').selectOption("3");
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const scroller = document.querySelector("#app-main");
      if (scroller) scroller.scrollTop = 0;
    });
    await shot("08-supply-ai-intake");
    // 材料区也拍完整可读视口，避免只剩四行材料而丢掉页面上下文。
    await page.locator(".evidence-upload-panel").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await shot("09-supply-details");

    // 出租任务必须走完真实的上传和人工核验门槛。四份文件只使用仓库内的
    // 测试图片；审核令牌也只供本地截图服务使用。
    for (const kind of ["identity", "roleDocument", "rightsDocument", "livePhotoChallenge"]) {
      const upload = page.waitForResponse(
        (r) => r.url().includes("/api/evidence") && r.request().method() === "POST",
        { timeout: 30_000 }
      );
      await page.locator(`#evidence-${kind}`).setInputFiles(EVIDENCE_FIXTURE);
      const uploadResponse = await upload;
      const evidence = await uploadResponse.json();
      const review = await page.evaluate(async ({ evidenceId, token }) => {
        const response = await fetch(`/api/admin/evidence/${encodeURIComponent(evidenceId)}/review`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Review-Token": token
          },
          body: JSON.stringify({ reviewer: "readme-showcase", result: "approved" })
        });
        return { ok: response.ok, status: response.status, body: await response.text() };
      }, { evidenceId: evidence.id, token: ADMIN_REVIEW_TOKEN });
      if (!review.ok) throw new Error(`演示材料审核失败（${kind}, HTTP ${review.status}）：${review.body}`);
    }

    await page.locator('[data-action="scan-supply"]').click();
    await page.locator('[data-action="publish-supply"]').waitFor({ state: "visible", timeout: 10_000 });
    await page.locator('[data-action="toggle-supply-pledge"]').check();
    await page.locator('[data-action="publish-supply"]').click();
    await page.locator(".tenant-card").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(800);
    await shot("11-supply-tenant-results", { selector: ".results-screen" });
  }

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  if (await clickIfPresent('.tab-item:has-text("我的")')) {
    await page.waitForTimeout(700);
    if (await clickIfPresent('[data-action="open-insights"]')) await page.waitForTimeout(900);
  }
  await shot("12-neutral-insights");

  await browser.close();

  // 自检：不同名字的图不应内容相同，否则说明等待时机或滚动没生效
  const crypto = await import("node:crypto");
  const files = (await fs.readdir(OUT)).filter((n) => /^\d\d-.*\.png$/.test(n)).sort();
  const seen = new Map();
  const dupes = [];
  for (const name of files) {
    const hash = crypto.createHash("md5").update(await fs.readFile(path.join(OUT, name))).digest("hex");
    if (seen.has(hash)) dupes.push([seen.get(hash), name]);
    else seen.set(hash, name);
  }
  if (dupes.length) {
    console.error("\n检测到内容重复的截图（很可能是等待时机或滚动未生效）：");
    for (const [a, b] of dupes) console.error(`  ${a} === ${b}`);
    process.exitCode = 1;
  } else {
    console.log(`\n完成，${files.length} 张图内容各不相同。仍请人工确认每张是否落在预期界面。`);
  }
}

main().catch((error) => {
  console.error("展示截图生成失败：", error.message);
  process.exit(1);
});
