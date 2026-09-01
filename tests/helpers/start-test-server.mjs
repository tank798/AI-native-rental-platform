import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRentalServer } from "../../server.mjs";
import { createClock } from "../../src/clock.mjs";
import { baseMandate, demoSupplyDraft } from "../../src/fixtures.mjs";
import { testContactEncryptionKey } from "../test-secrets.mjs";

const FIXED_NOW = "2026-08-31T04:00:00.000Z";
const EXPIRES_AT = "2026-09-30T04:00:00.000Z";

function createPersistedTask(app, { ownerId, kind, label, payload, status = "active" }) {
  const id = randomUUID();
  const created = app.repository.createTaskIdempotent({
    id,
    ownerId,
    kind,
    label,
    payload: { ...payload, inputVersion: payload.inputVersion || 1 },
    expiresAt: EXPIRES_AT,
    clientRequestId: randomUUID()
  }).task;
  if (status !== "active") app.repository.setTaskStatus(id, ownerId, status);
  app.worker.drain();
  return app.repository.getTask(id) || created;
}

/** Starts an isolated app that cannot read the project's database, uploads, or AI key file. */
export async function startTestServer({ adminReviewToken = null } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-ui-"));
  const clock = createClock({ now: () => new Date(FIXED_NOW) });
  const app = createRentalServer({
    databasePath: path.join(tempDir, "test.sqlite"),
    uploadRoot: path.join(tempDir, "uploads"),
    enableScheduler: false,
    marketMode: "real",
    aiApiKey: null,
    aiKeyFile: null,
    environment: {},
    ...(adminReviewToken ? { adminReviewToken } : {}),
    clock,
    contactEncryptionKey: testContactEncryptionKey()
  });
  let address;
  try {
    address = await app.listen(0);
  } catch (error) {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
  const baseURL = `http://127.0.0.1:${address.port}`;

  function seedRenter(ownerId, overrides = {}) {
    const mandate = structuredClone(baseMandate);
    Object.assign(mandate, overrides.mandate || {});
    mandate.id = randomUUID();
    if (overrides.location) mandate.locations = [overrides.location];
    return createPersistedTask(app, {
      ownerId,
      kind: "renter",
      label: overrides.label || mandate.locations.join(" / "),
      status: overrides.status,
      payload: { mandate, rawText: overrides.rawText || "浏览器测试找房需求", inputVersion: 1, fieldStates: {} }
    });
  }

  function seedSupply(ownerId, overrides = {}) {
    const draft = structuredClone(demoSupplyDraft);
    Object.assign(draft, overrides.draft || {});
    if (overrides.location) {
      draft.location = overrides.location;
      draft.station = `${overrides.location}站`;
      draft.district = "静安区";
    }
    if (overrides.title) draft.title = overrides.title;
    return createPersistedTask(app, {
      ownerId,
      kind: "supply",
      label: overrides.label || draft.title,
      status: overrides.status,
      payload: { draft, rawText: overrides.rawText || "浏览器测试出租房源", inputVersion: 1, fieldStates: {} }
    });
  }

  function seedPair(renterOwnerId, supplyOwnerId, overrides = {}) {
    const renterTask = seedRenter(renterOwnerId, overrides.renter);
    const supplyTask = seedSupply(supplyOwnerId, overrides.supply);
    app.worker.drain();
    const renterSnapshot = app.matching.snapshot(renterTask.id);
    const supplySnapshot = app.matching.snapshot(supplyTask.id);
    // 必须用「这两个任务构成的案例」精确定位，不能取 candidates[0]：
    // 测试文件共用一个服务端，先前用例的任务会与新任务互相匹配，
    // 因此租客的第一个候选很可能属于另一个房源。
    // 且候选排序按接收方视角各自计算，索引位置本身不是稳定契约。
    const pairedCase = app.matching.matchCaseRepository
      .listForTask(renterTask.id)
      .find((item) => item.renterTaskId === renterTask.id && item.supplyTaskId === supplyTask.id);
    const matchCaseId = pairedCase?.id;
    if (!matchCaseId) throw new Error("测试夹具未生成匹配案例");
    return { renterTask, supplyTask, renterSnapshot, supplySnapshot, matchCaseId };
  }

  return {
    app,
    baseURL,
    tempDir,
    seedRenter,
    seedSupply,
    seedPair,
    setContact(ownerId, type, value) {
      return app.matching.contacts.set(ownerId, { type, value });
    },
    async close() {
      await app.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

export async function currentOwnerId(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    return (await response.json()).userId;
  });
}
