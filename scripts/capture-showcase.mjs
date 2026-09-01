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

const RENTER_TEXT = "静安寺附近，预算 3000 到 3500，9 月 3 日入住，女生合租，租 12 个月，通勤 35 分钟，需要厨房和洗衣机";
const SUPPLY_TEXT = "当前租客个人转租，静安寺站，月租 3200 元，最低 3000 元，9 月 3 日入住，15 平，9/18 层，2 位女生室友，有洗衣机和电梯，朝南，无中介费无服务费";

async function main() {
  const { chromium } = await import("playwright");
  await fs.mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const context = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
  const page = await context.newPage();

  const shot = async (name) => {
    // 冻结动画，保证同一界面每次产出一致的图，便于 diff 审阅
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none !important;transition:none !important}" });
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
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
  // 04 要的是"正在持续匹配"的中间态，必须在候选到达之前抓
  await page.waitForTimeout(900);
  await shot("04-continuous-matching");

  // 05 要的是候选已投放的结果页，等卡片真正出现再抓
  await page.locator('[data-action="open-candidate"]').first()
    .waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(800);
  await shot("05-renter-results");

  if (await clickIfPresent('[data-action="open-candidate"]')) {
    await page.waitForTimeout(1500);
    await shot("06-candidate-detail");
    // 协商记录位于详情页下半部分。滚动容器是 #app-main（.screen-scroll），
    // 不是 window —— 用 window.scrollBy 会导致 06/07 截出同一张图。
    await page.evaluate(() => {
      const scroller = document.querySelector("#app-main");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForTimeout(800);
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
    await page.waitForTimeout(900);
    await shot("08-supply-ai-intake");
    await page.evaluate(() => {
      const scroller = document.querySelector("#app-main");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForTimeout(800);
    await shot("09-supply-details");
  }

  // 出租端候选与数据页
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  if (await clickIfPresent('[data-action="open-task-center"]')) await page.waitForTimeout(900);
  await shot("11-supply-tenant-results");

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
