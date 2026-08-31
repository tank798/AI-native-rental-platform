import { createClock } from "../clock.mjs";

function publicStatus(evidence, review) {
  if (!evidence) return null;
  if (!review) {
    return {
      evidenceId: evidence.id,
      kind: evidence.kind,
      submissionStatus: "submitted",
      verificationStatus: "not_reviewed",
      displayLabel: "已上传，待审核",
      source: null,
      reviewedAt: null
    };
  }
  const approved = review.result === "approved";
  return {
    evidenceId: evidence.id,
    kind: evidence.kind,
    submissionStatus: "submitted",
    verificationStatus: approved ? "verified" : "rejected",
    displayLabel: approved ? "人工审核通过" : "审核未通过",
    source: review.method,
    reviewedAt: review.reviewedAt
  };
}

/** Keeps file submission facts separate from explicit reviewer decisions. */
export function createVerificationService({ repository, clock = createClock() }) {
  if (!repository) throw new Error("createVerificationService 需要 repository");

  function statusFor(evidenceId, ownerId) {
    const evidence = repository.getEvidence(evidenceId, ownerId);
    if (!evidence) return null;
    return publicStatus(evidence, repository.latestEvidenceReview(evidenceId, ownerId));
  }

  return {
    statusFor,

    reviewEvidence({ evidenceId, reviewer, method, result, reviewedAt = clock.nowIso() }) {
      if (!String(reviewer || "").trim()) throw new Error("reviewer 不能为空");
      if (method !== "manual_review") throw new Error("verification method 必须是 manual_review");
      if (!["approved", "rejected"].includes(result)) throw new Error("verification result 必须是 approved 或 rejected");
      const ownerId = repository.getEvidenceOwner(evidenceId);
      if (!ownerId) throw new Error("待审核材料不存在");
      repository.addEvidenceReview({ evidenceId, reviewer: String(reviewer).trim(), method, result, reviewedAt });
      return statusFor(evidenceId, ownerId);
    }
  };
}
