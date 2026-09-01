import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { currentOwnerId, startTestServer } from "./helpers/start-test-server.mjs";

let testServer;

test.beforeAll(async () => {
  testServer = await startTestServer();
});

test.afterAll(async () => {
  await testServer?.close();
});

async function openAccount(browser, width = 430) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  await page.goto(testServer.baseURL);
  await expect(page.locator('[data-connection-phase="online"]')).toBeVisible();
  return { context, page, ownerId: await currentOwnerId(page) };
}

async function setContact(page, type, value) {
  const result = await page.evaluate(async ({ contactType, contactValue }) => {
    const response = await fetch("/api/profile/contact", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: contactType, value: contactValue })
    });
    return { status: response.status, payload: await response.json() };
  }, { contactType: type, contactValue: value });
  expect(result.status).toBe(200);
}

async function publishRenter(page) {
  const text = "静安寺附近，预算 3000 到 3100，9 月 3 日入住，女生合租，租 12 个月，通勤 35 分钟，需要厨房和洗衣机";
  await page.locator('[data-input="draft-text"]').fill(text);
  await page.locator('[data-input="draft-text"]').press("Enter");
  await expect(page.locator('[data-action="review-mandate"]')).toBeVisible();
  await page.locator('[data-input="budget-min"]').fill("3000");
  await page.locator('[data-input="budget-max"]').fill("3100");
  await page.locator('[data-input="move-in-from"]').fill("2026-09-03");
  await page.locator('[data-input="move-in-to"]').fill("2026-09-05");
  await page.locator('[data-action="set-answer"][data-key="roommate"][data-value="female"]').click();
  await page.locator('[data-action="set-answer"][data-key="leaseMonths"][data-value="12"]').click();
  await page.locator('[data-action="set-answer"][data-key="kitchen"][data-value="required"]').click();
  await page.locator('[data-action="set-answer"][data-key="washer"][data-value="required"]').click();
  await page.locator('[data-action="review-mandate"]').click();
  await expect(page.getByRole("heading", { name: /静安寺/u })).toBeVisible();
  await page.locator('[data-action="toggle-consent"]').check();
  await page.locator('[data-action="publish-mandate"]').click();
  await expect(page).toHaveURL(/\?task=[0-9a-f-]+$/u);
  await expect(page.getByRole("heading", { name: "0 个合适" })).toBeVisible();
  return new URL(page.url()).searchParams.get("task");
}

async function uploadEvidence(page, kind, file) {
  const responsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/api/evidence")
      && response.request().method() === "POST"
      && response.status() === 201
  ));
  await page.locator(`[data-evidence-file="${kind}"]`).setInputFiles(file);
  const response = await responsePromise;
  const payload = await response.json();
  await expect(page.getByText("已上传，待审核").last()).toBeVisible();
  return payload.id;
}

async function publishSupply(page, imageFile) {
  await page.locator('[data-action="create-supply"]').click();
  const text = "当前租客个人转租，静安寺站，月租 3200 元，最低 3000 元，9 月 3 日入住，15 平，9/18 层，2 位女生室友，有洗衣机和电梯，朝南，无中介费无服务费";
  await page.locator('[data-input="supply-text"]').fill(text);
  await page.locator('[data-input="supply-text"]').press("Enter");
  await expect(page.locator('[data-action="scan-supply"]')).toBeVisible();
  await page.locator('[data-input="supply-address"]').fill("上海市静安区南阳路 100 号");
  await page.locator('[data-input="supply-available"]').fill("2026-09-03");
  await page.locator('[data-input="supply-lease"]').selectOption("12");

  const evidenceIds = [];
  for (const kind of ["identity", "roleDocument", "rightsDocument"]) {
    evidenceIds.push(await uploadEvidence(page, kind, imageFile));
  }

  await page.locator('[data-action="open-photo-source"]').first().click();
  const liveResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/api/evidence")
      && response.request().method() === "POST"
      && response.status() === 201
  ));
  await page.locator("#library-input").setInputFiles(imageFile);
  const liveResponse = await liveResponsePromise;
  evidenceIds.push((await liveResponse.json()).id);
  await expect(page.locator('[data-action="toggle-photo-consent"]')).toBeEnabled();
  await page.locator('[data-action="toggle-photo-consent"]').check();

  for (const evidenceId of evidenceIds) {
    const reviewed = testServer.app.verification.reviewEvidence({
      evidenceId,
      reviewer: "browser-e2e-reviewer",
      method: "manual_review",
      result: "approved"
    });
    expect(reviewed.verificationStatus).toBe("verified");
  }

  await page.locator('[data-action="scan-supply"]').click();
  await expect(page.getByRole("heading", { name: "静安寺个人房源" })).toBeVisible();
  await page.locator('[data-action="toggle-supply-pledge"]').check();
  await page.locator('[data-action="publish-supply"]').click();
  await expect(page).toHaveURL(/\?task=[0-9a-f-]+$/u);
  await expect(page.locator('[data-action="open-candidate"]')).toBeVisible();
  return new URL(page.url()).searchParams.get("task");
}

async function caseForTask(page, taskId) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`);
    const payload = await response.json();
    return payload.candidates[0]?.matchCaseId || null;
  }, taskId);
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
    app: document.querySelector("#app").scrollWidth - document.querySelector("#app").clientWidth
  }));
  expect(overflow).toEqual({ document: 0, body: 0, app: 0 });
}

test("两个真实账号从空市场完成澄清、同版确认、解锁并在变更后重新锁定", async ({ browser }) => {
  const renter = await openAccount(browser, 375);
  const supply = await openAccount(browser, 430);
  const imageBuffer = await sharp({
    create: { width: 480, height: 320, channels: 3, background: "#b6c8d5" }
  }).jpeg({ quality: 85 }).toBuffer();
  const imageFile = { name: "demo-room.jpg", mimeType: "image/jpeg", buffer: imageBuffer };

  try {
    await setContact(renter.page, "wechat", "renter_browser_e2e");
    await setContact(supply.page, "email", "supply.browser.e2e@example.com");
    const renterTaskId = await publishRenter(renter.page);
    const supplyTaskId = await publishSupply(supply.page, imageFile);

    await expect(renter.page.locator('[data-action="open-candidate"]')).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => caseForTask(renter.page, renterTaskId)).not.toBeNull();
    const renterCaseId = await caseForTask(renter.page, renterTaskId);
    const supplyCaseId = await caseForTask(supply.page, supplyTaskId);
    expect(supplyCaseId).toBe(renterCaseId);

    await supply.page.locator('[data-action="open-candidate"]').click();
    await expect(supply.page.getByRole("heading", { name: "需要你补充信息" })).toBeVisible();

    // 租客可接受上限（3100）低于挂牌价（3200），因此系统不会直接拿租客的
    // 私密上限当成交价，而是先请房东自主给出一个可接受的月租。
    // 房东给 3050（低于租客上限），因此成交价取房东自己的数字，
    // 房东无法从中反推出租客的确切上限。
    const concessionAsk = supply.page.getByRole("spinbutton", { name: /议价/u });
    await expect(concessionAsk).toBeVisible();
    await concessionAsk.fill("3050");
    await supply.page.getByRole("button", { name: "提交" }).click();

    await expect(supply.page.getByRole("button", { name: "是" })).toBeVisible();
    await supply.page.getByRole("button", { name: "是" }).click();
    await expect(supply.page.getByRole("button", { name: "按账单另付" })).toBeVisible();
    await supply.page.getByRole("button", { name: "按账单另付" }).click();
    await expect(supply.page.getByRole("button", { name: /确认条款 v/u })).toBeEnabled();

    await renter.page.locator('[data-action="open-candidate"]').click();
    await expect(renter.page.getByRole("button", { name: /确认条款 v/u })).toBeEnabled({ timeout: 10_000 });
    const renterVersion = await renter.page.locator(".case-progress-card header span").textContent();
    const supplyVersion = await supply.page.locator(".case-progress-card header span").textContent();
    expect(renterVersion?.match(/条款 v\d+/u)?.[0]).toBe(supplyVersion?.match(/条款 v\d+/u)?.[0]);

    await renter.page.locator('[data-action="confirm-match"]').click();
    await expect(renter.page.getByRole("button", { name: "你已确认，等待对方" })).toBeDisabled();
    await expect(renter.page.getByRole("button", { name: "点击查看对方联系方式" })).toHaveCount(0);
    await expect(supply.page.getByRole("heading", { name: "对方已确认，等待你" })).toBeVisible({ timeout: 10_000 });
    await supply.page.locator('[data-action="confirm-match"]').click();
    await expect(supply.page.getByRole("heading", { name: "双方已确认同一条款" })).toBeVisible();
    await expect(renter.page.getByRole("heading", { name: "双方已确认同一条款" })).toBeVisible({ timeout: 10_000 });

    await renter.page.getByRole("button", { name: "点击查看对方联系方式" }).click();
    await expect(renter.page.getByText("supply.browser.e2e@example.com")).toBeVisible();
    await supply.page.getByRole("button", { name: "点击查看对方联系方式" }).click();
    await expect(supply.page.getByText("renter_browser_e2e")).toBeVisible();

    await Promise.all([renter.page.reload(), supply.page.reload()]);
    await expect(renter.page.getByRole("heading", { name: "双方已确认同一条款" })).toBeVisible();
    await expect(supply.page.getByRole("heading", { name: "双方已确认同一条款" })).toBeVisible();

    await supply.page.evaluate(async (taskId) => {
      await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" })
      });
      await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" })
      });
    }, supplyTaskId);
    await expect(renter.page.getByRole("heading", { name: "条款已变化，需要重新确认" })).toBeVisible({ timeout: 10_000 });
    await expect(renter.page.getByRole("button", { name: "点击查看对方联系方式" })).toHaveCount(0);

    for (const width of [320, 375, 430]) {
      await renter.page.setViewportSize({ width, height: 820 });
      await assertNoHorizontalOverflow(renter.page);
    }
  } finally {
    await renter.context.close();
    await supply.context.close();
  }
});
