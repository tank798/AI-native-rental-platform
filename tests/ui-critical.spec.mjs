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
  // 就绪判定使用外壳上的状态属性：连接正常时横幅会塌缩隐藏（简约设计），
  // 不应把"应用已连接"耦合到某个可见横幅上。
  await expect(page.locator("[data-app-connection]")).toHaveAttribute("data-app-connection", "online");
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
    // 断言"双方看到同一个案例"，而不是"双方的第一个候选恰好相同"。
    // 候选投放按接收方视角各自排序（租客看综合/价格/居住条件，
    // 房东看出价/租期），因此索引对称是偶然前提，不能依赖。
    // 且本文件共用一个测试服务端，先前用例 seed 的任务会与新任务互相匹配。
    expect(seeded.renterSnapshot.candidates.map((item) => item.matchCaseId))
      .toContain(seeded.matchCaseId);
    expect(seeded.supplySnapshot.candidates.map((item) => item.matchCaseId))
      .toContain(seeded.matchCaseId);

    await renter.page.goto(`${testServer.baseURL}/?task=${seeded.renterTask.id}`);
    // 按标题精确定位本用例的候选，不依赖它排在第几位。
    const candidateButton = renter.page
      .locator('[data-action="open-candidate"]')
      .filter({ hasText: maliciousTitle });
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
    await renter.page.locator('[data-input="viewing-starts-at"]').fill("2026-09-05T10:30");
    await renter.page.getByRole("button", { name: "发送给对方" }).click();
    await expect(renter.page.getByText("等待对方回应")).toBeVisible();
    await expect(supply.page.getByRole("button", { name: "接受" })).toBeVisible({ timeout: 8_000 });
    await supply.page.getByRole("button", { name: "接受" }).click();
    await expect(supply.page.getByText("双方已约定")).toBeVisible();
  } finally {
    await renter.context.close();
    await supply.context.close();
  }
});

test("连接失败持续可见，重试成功后恢复且通过独立 live region 播报", async ({ page }) => {
  let failHealth = true;
  await page.route("**/api/health", async (route) => {
    if (!failHealth) return route.continue();
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "测试断网" }) });
  });

  await page.goto(testServer.baseURL);
  const connection = page.locator("[data-connection-phase]");
  await expect(connection).toHaveAttribute("data-connection-phase", "offline");
  await expect(connection).toContainText("重试");
  failHealth = false;
  await connection.getByRole("button", { name: "重试" }).click();
  await expect(connection).toHaveAttribute("data-connection-phase", "online");
  await expect(page.locator("#app-live-region")).toHaveText("连接已恢复");
  await expect(page.locator("#app")).not.toHaveAttribute("aria-live", /.+/u);
});

test("需求错误显示在字段旁并把焦点移到第一个无效字段", async ({ page }) => {
  await page.goto(testServer.baseURL);
  // 就绪判定使用外壳上的状态属性：连接正常时横幅会塌缩隐藏（简约设计），
  // 不应把"应用已连接"耦合到某个可见横幅上。
  await expect(page.locator("[data-app-connection]")).toHaveAttribute("data-app-connection", "online");
  await page.locator('[data-input="draft-text"]').fill("静安寺附近找房");
  await page.locator('[data-action="home-intake"]').click();
  await expect(page.locator('[data-action="review-mandate"]')).toBeVisible();
  await page.locator('[data-action="review-mandate"]').click();

  const budgetMin = page.locator('[data-input="budget-min"]');
  await expect(budgetMin).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#field-error-budget")).toContainText("月租范围");
  await expect(budgetMin).toBeFocused();
  await expect(page.locator(".toast")).toHaveCount(0);

  await budgetMin.fill("3000");
  await page.locator('[data-input="budget-max"]').fill("3500");
  await expect(page.locator("#field-error-budget")).toHaveCount(0);
  await page.locator('[data-input="move-in-from"]').fill("2026-09-03");
  await page.locator('[data-input="move-in-to"]').fill("2026-09-10");
  await page.locator('[data-action="review-mandate"]').click();
  await expect(page.getByRole("heading", { name: /静安寺/u })).toBeVisible();
});

test("弹层限制键盘焦点、支持 Esc 并恢复到触发按钮", async ({ page }) => {
  await page.goto(testServer.baseURL);
  const trigger = page.locator('[data-action="open-create"]');
  await trigger.focus();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "新建任务" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(await page.locator("#app-main").evaluate((element) => element.inert)).toBe(true);
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("320、375、430 像素视口均无水平溢出", async ({ page }) => {
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 780 });
    await page.goto(testServer.baseURL);
    await expect(page.locator("#app-main")).toBeVisible();
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
      app: document.querySelector("#app").scrollWidth - document.querySelector("#app").clientWidth
    }));
    expect(overflow).toEqual({ document: 0, body: 0, app: 0 });
  }
});
