import { expect, test } from "@playwright/test";

import { currentOwnerId, startTestServer } from "./helpers/start-test-server.mjs";

let testServer;

test.beforeAll(async () => {
  testServer = await startTestServer();
});

test.afterAll(async () => {
  await testServer?.close();
});

async function openFreshPage(browser) {
  const context = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const page = await context.newPage();
  await page.goto(testServer.baseURL);
  await expect(page.locator("#app-main")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const ownerId = await currentOwnerId(page);
  return { context, page, ownerId };
}

test("用户修改 AI 预填后，发布请求使用用户最终确认值", async ({ page }) => {
  const taskId = "33333333-3333-4333-8333-333333333333";
  let submittedBody;
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    submittedBody = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        task: {
          id: taskId,
          kind: "renter",
          status: "active",
          label: "静安寺",
          scanned: 0,
          suitable: 0,
          runCount: 1,
          candidateVersion: 0,
          createdAt: "2026-08-31T04:00:00.000Z",
          updatedAt: "2026-08-31T04:00:00.000Z",
          lastMatchAt: "2026-08-31T04:00:00.000Z",
          expiresAt: "2026-09-30T04:00:00.000Z"
        },
        candidates: [],
        events: []
      })
    });
  });

  await page.goto(testServer.baseURL);
  await page.locator('[data-input="draft-text"]').fill("静安寺附近，预算3000到3200，9月3日入住，女生合租，租12个月");
  await page.locator('[data-action="home-intake"]').click();
  await expect(page.locator('[data-input="budget-max"]')).toHaveValue("3200");
  await page.locator('[data-input="budget-max"]').fill("3456");
  await page.locator('[data-action="review-mandate"]').click();
  await expect(page.getByText("¥3,000—3,456 / 月")).toBeVisible();
  await page.locator('[data-action="toggle-consent"]').check();
  await page.locator('[data-action="publish-mandate"]').click();
  await expect.poll(() => submittedBody?.payload?.mandate?.budget?.hardMax).toBe(3456);
  expect(submittedBody.payload.fieldStates.budgetMax.value).toBe("3456");
});

test("我的任务展示多任务，可切换并暂停恢复，恶意标题只作为文本", async ({ browser }) => {
  const { context, page, ownerId } = await openFreshPage(browser);
  try {
    const malicious = '</strong><img id="task-pwn" src=x onerror="window.__taskPwn=1">';
    const first = testServer.seedRenter(ownerId, { label: malicious });
    const second = testServer.seedRenter(ownerId, { label: "江苏路通勤需求" });

    await page.goto(`${testServer.baseURL}/?task=${first.id}`);
    await expect(page.locator('[data-action="open-candidate"]')).toHaveCount(0);
    await page.locator('.tab-item[data-value="profile"]').click();
    await page.locator('[data-action="open-task-center"]').click();
    await expect(page).toHaveURL(/\?view=tasks$/u);
    await expect(page.locator("[data-task-card]")).toHaveCount(2);
    await expect(page.locator(`[data-task-card="${first.id}"]`)).toContainText(malicious);
    expect(await page.evaluate(() => ({ injected: Boolean(document.querySelector("#task-pwn")), ran: window.__taskPwn })))
      .toEqual({ injected: false, ran: undefined });

    const firstCard = page.locator(`[data-task-card="${first.id}"]`);
    await firstCard.locator('[data-action="set-task-status"][data-value="paused"]').click();
    await expect(firstCard).toContainText("已暂停");
    await firstCard.locator('[data-action="set-task-status"][data-value="active"]').click();
    await expect(firstCard).toContainText("持续匹配中");

    await page.locator(`[data-task-card="${second.id}"] [data-action="open-task"]`).click();
    await expect(page).toHaveURL(new RegExp(`\\?task=${second.id}$`, "u"));
    await expect(page.getByRole("heading", { name: "0 个合适" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("两个会话生成同一案例，详情深链支持刷新和前进后退且无样板房", async ({ browser }) => {
  const renter = await openFreshPage(browser);
  const supply = await openFreshPage(browser);
  try {
    const maliciousTitle = '朝南次卧</h1><img id="listing-pwn" src=x onerror="window.__listingPwn=1">';
    const seeded = testServer.seedPair(renter.ownerId, supply.ownerId, {
      supply: { title: maliciousTitle, label: "恶意标题安全测试" }
    });
    expect(seeded.renterSnapshot.candidates[0].matchCaseId)
      .toBe(seeded.supplySnapshot.candidates[0].matchCaseId);

    await renter.page.goto(`${testServer.baseURL}/?task=${seeded.renterTask.id}`);
    const candidateButton = renter.page.locator('[data-action="open-candidate"]');
    await expect(candidateButton).toContainText(maliciousTitle);
    await expect(renter.page.locator("#listing-pwn")).toHaveCount(0);
    expect(await renter.page.evaluate(() => window.__listingPwn)).toBeUndefined();
    await expect(candidateButton.getByText("暂无公开实拍")).toBeVisible();
    await expect(candidateButton.locator("img[data-listing-photo]")).toHaveCount(0);

    await candidateButton.click();
    const detailUrl = `${testServer.baseURL}/?task=${seeded.renterTask.id}&match=${seeded.matchCaseId}`;
    await expect(renter.page).toHaveURL(detailUrl);
    await expect(renter.page.locator("[data-match-detail] h1")).toHaveText(maliciousTitle);
    await renter.page.reload();
    await expect(renter.page.locator("[data-match-detail] h1")).toHaveText(maliciousTitle);

    await renter.page.locator('[data-action="back-match-detail"]').click();
    await expect(renter.page).toHaveURL(`${testServer.baseURL}/?task=${seeded.renterTask.id}`);
    await renter.page.goForward();
    await expect(renter.page).toHaveURL(detailUrl);
    await expect(renter.page.locator("[data-match-detail]")).toBeVisible();
  } finally {
    await renter.context.close();
    await supply.context.close();
  }
});

test("非所有者打开任务 URL 时回退任务中心且不泄露任务内容", async ({ browser }) => {
  const owner = await openFreshPage(browser);
  const outsider = await openFreshPage(browser);
  try {
    const privateLabel = "仅所有者可见的浦东任务";
    const task = testServer.seedRenter(owner.ownerId, { label: privateLabel });
    await outsider.page.goto(`${testServer.baseURL}/?task=${task.id}`);
    await expect(outsider.page).toHaveURL(`${testServer.baseURL}/?view=tasks`);
    await expect(outsider.page.getByRole("alert")).toContainText("不属于当前账号");
    await expect(outsider.page.getByText(privateLabel)).toHaveCount(0);
    await expect(outsider.page.locator(`[data-task-card="${task.id}"]`)).toHaveCount(0);
  } finally {
    await owner.context.close();
    await outsider.context.close();
  }
});

test("单方确认仍锁定联系人，双方确认同版条款后才解锁", async ({ browser }) => {
  const renter = await openFreshPage(browser);
  const supply = await openFreshPage(browser);
  try {
    const seeded = testServer.seedPair(renter.ownerId, supply.ownerId);
    testServer.setContact(renter.ownerId, "wechat", "renter_ui_e2e");
    testServer.setContact(supply.ownerId, "email", "supply.ui.e2e@example.com");
    const renterUrl = `${testServer.baseURL}/?task=${seeded.renterTask.id}&match=${seeded.matchCaseId}`;
    const supplyUrl = `${testServer.baseURL}/?task=${seeded.supplyTask.id}&match=${seeded.matchCaseId}`;

    await Promise.all([renter.page.goto(renterUrl), supply.page.goto(supplyUrl)]);
    await expect(renter.page.locator('[data-action="confirm-match"]')).toBeEnabled();
    await expect(renter.page.getByText("确认后开放")).toBeVisible();
    await renter.page.locator('[data-action="confirm-match"]').click();
    await expect(renter.page.getByRole("button", { name: "你已确认，等待对方" })).toBeDisabled();
    await expect(renter.page.getByText("点击查看对方联系方式")).toHaveCount(0);

    await supply.page.locator('[data-action="confirm-match"]').click();
    await expect(supply.page.getByRole("heading", { name: "双方已确认同一条款" })).toBeVisible();
    await expect(renter.page.getByRole("button", { name: "点击查看对方联系方式" })).toBeVisible({ timeout: 8_000 });
    await renter.page.getByRole("button", { name: "点击查看对方联系方式" }).click();
    await expect(renter.page.getByText("supply.ui.e2e@example.com")).toBeVisible();
  } finally {
    await renter.context.close();
    await supply.context.close();
  }
});
