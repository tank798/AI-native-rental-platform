import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createClock } from "../src/clock.mjs";
import { openRentalDatabase } from "../src/server/database.mjs";
import { createVerificationService } from "../src/server/verification-service.mjs";

test("上传只产生待审核 submission，显式人工审核才产生 verified 事实", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhunaer-verification-"));
  const clock = createClock({ now: () => new Date("2026-08-29T16:00:00.000Z") });
  const repository = openRentalDatabase(path.join(tempDir, "rental.sqlite"), { clock });
  const verification = createVerificationService({ repository, clock });
  t.after(async () => {
    repository.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  repository.createProfile({ id: "owner-1", tokenHash: "profile-test-1" });
  repository.addEvidence({
    id: "evidence-1",
    ownerId: "owner-1",
    kind: "identity",
    storagePath: "/private/evidence-1.jpg",
    originalName: "identity.jpg",
    mimeType: "image/jpeg",
    sha256: "abc"
  });

  assert.deepEqual(verification.statusFor("evidence-1", "owner-1"), {
    evidenceId: "evidence-1",
    kind: "identity",
    submissionStatus: "submitted",
    verificationStatus: "not_reviewed",
    displayLabel: "已上传，待审核",
    source: null,
    reviewedAt: null
  });

  const reviewed = verification.reviewEvidence({
    evidenceId: "evidence-1",
    reviewer: "reviewer-007",
    method: "manual_review",
    result: "approved"
  });
  assert.equal(reviewed.verificationStatus, "verified");
  assert.equal(reviewed.source, "manual_review");
  assert.equal(reviewed.reviewedAt, "2026-08-29T16:00:00.000Z");
  assert.throws(
    () => verification.reviewEvidence({ evidenceId: "evidence-1", reviewer: "owner-1", method: "self_asserted", result: "approved" }),
    /manual_review/
  );
});
