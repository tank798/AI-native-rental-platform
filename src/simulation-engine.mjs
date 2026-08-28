import {
  SIMULATION_DATE,
  baseMandate,
  demoSupplyDraft,
  getListingsByIds,
  labScenarios,
  listings,
  tenantCases
} from "./fixtures.mjs";

const ALLOWED_SUPPLY_ROLES = new Set(["landlord", "subletter"]);

const reasonLabels = {
  broker_role: "实际角色为中介或经纪人",
  role_conflict: "申报角色与平台证据冲突",
  prohibited_fee: "存在中介费或服务费",
  duplicate_photo: "图片疑似跨平台盗用或重复",
  stale: "房源已超过实时核验有效期",
  rights_missing: "出租权材料未完成核验",
  location: "位置不在委托范围",
  commute: "通勤时间超过上限",
  move_in: "可入住时间不匹配",
  roommate_gender: "室友性别与硬性要求不匹配",
  kitchen: "没有可用厨房",
  washer: "没有可用洗衣机",
  shared_housing: "该房源需要与他人合租",
  ensuite: "没有独立卫生间",
  elevator: "房源没有电梯",
  lease_term: "可接受租期短于房源最低租期",
  budget: "未能在授权预算内达成意向"
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function compareDate(a, b) {
  return new Date(`${a}T00:00:00+08:00`).getTime() - new Date(`${b}T00:00:00+08:00`).getTime();
}

function money(value) {
  return `¥${Number(value).toLocaleString("zh-CN")}`;
}

function hasProhibitedFee(listing) {
  return Number(listing.fees?.service || 0) > 0 || Number(listing.fees?.intermediary || 0) > 0;
}

function normalizePlace(value) {
  return String(value || "")
    .replace(/(?:上海市|上海|市|区|县|地铁站|站|商圈|附近|周边|一带)/g, "")
    .replace(/[\s·・]/g, "")
    .trim();
}

function locationMatches(requestedLocations, listing) {
  const listingPlaces = [listing.location, listing.station, listing.district, listing.addressHint]
    .map(normalizePlace)
    .filter(Boolean);

  return requestedLocations.some((requested) => {
    const query = normalizePlace(requested);
    if (!query) return false;
    return listingPlaces.some((place) => place.includes(query) || query.includes(place));
  });
}

function integrityAssessment(listing) {
  const reasons = [];

  if (!ALLOWED_SUPPLY_ROLES.has(listing.role)) reasons.push("broker_role");
  if (listing.evidence?.roleConflict) reasons.push("role_conflict");
  if (hasProhibitedFee(listing) || listing.evidence?.feeMessage) reasons.push("prohibited_fee");
  if (listing.evidence?.duplicatePhoto) reasons.push("duplicate_photo");

  if (reasons.length) {
    return { disposition: "quarantine", reasons: [...new Set(reasons)] };
  }

  if (listing.freshness === "stale" || listing.verification?.liveSite === "expired") {
    return { disposition: "excluded", reasons: ["stale"] };
  }

  if (listing.verification?.rights === "missing") {
    return { disposition: "excluded", reasons: ["rights_missing"] };
  }

  return { disposition: "continue", reasons: [] };
}

function hardConstraintAssessment(mandate, listing) {
  const reasons = [];

  if (!locationMatches(mandate.locations, listing)) reasons.push("location");
  if (listing.commuteMinutes > mandate.maxCommuteMinutes) reasons.push("commute");
  if (compareDate(listing.availableFrom, mandate.moveInWindow.to) > 0) reasons.push("move_in");
  if (
    mandate.roommateGender &&
    listing.room?.roommateGender &&
    listing.room.roommateGender !== mandate.roommateGender
  ) {
    reasons.push("roommate_gender");
  }
  if (mandate.hardConstraints.kitchen && !listing.facilities?.kitchen) reasons.push("kitchen");
  if (mandate.hardConstraints.washer && !listing.facilities?.washer) reasons.push("washer");
  if (!mandate.sharedHousing && Number(listing.room?.roommateCount || 0) > 0) reasons.push("shared_housing");
  if (mandate.hardConstraints.ensuite && !listing.facilities?.ensuite) reasons.push("ensuite");
  if (mandate.hardConstraints.elevator && !listing.facilities?.elevator) reasons.push("elevator");
  if (Number(mandate.leaseMonths || 0) < Number(listing.leaseMonthsMin || 0)) reasons.push("lease_term");

  return reasons;
}

function conditionalOfferIsUsable(mandate, offer) {
  const leaseOkay = !offer.conditions?.leaseMonthsMin || mandate.leaseMonths >= offer.conditions.leaseMonthsMin;
  const dateOkay =
    !offer.conditions?.moveInOnOrBefore ||
    compareDate(mandate.moveInWindow.from, offer.conditions.moveInOnOrBefore) <= 0;
  return leaseOkay && dateOkay && offer.rent <= mandate.budget.hardMax;
}

export function negotiate(mandate, listing) {
  const publicEvents = [
    {
      type: "match_request",
      actor: "找房 AI",
      title: "发出匹配请求",
      detail: `确认 ${listing.availableFrom.slice(5).replace("-", "月")} 日前后可入住、${mandate.leaseMonths} 个月租期与费用清单。`
    },
    {
      type: "clarification",
      actor: "出租 AI",
      title: "返回房源条件",
      detail: `挂牌 ${money(listing.listedRent)}/月，押 ${listing.depositMonths} 个月；不收中介费、服务费。`
    }
  ];

  const usableConditionalOffers = (listing.conditionalOffers || [])
    .filter((offer) => conditionalOfferIsUsable(mandate, offer))
    .sort((a, b) => a.rent - b.rent);

  let agreedRent = null;
  let agreementLabel = "";

  if (usableConditionalOffers.length) {
    const offer = usableConditionalOffers[0];
    publicEvents.push({
      type: "offer",
      actor: "找房 AI",
      title: `提出 ${money(mandate.budget.target)}/月`,
      detail: "报价基于你的授权条件，没有透露最高预算。"
    });
    publicEvents.push({
      type: "conditional_acceptance",
      actor: "出租 AI",
      title: `有条件接受 ${money(offer.rent)}/月`,
      detail: offer.label
    });
    agreedRent = offer.rent;
    agreementLabel = offer.label;
  } else if (listing.listedRent <= mandate.budget.hardMax) {
    const openingOffer = Math.min(mandate.budget.target, listing.listedRent);
    const floor = Math.max(0, listing.minRent || listing.listedRent);
    agreedRent = Math.min(listing.listedRent, Math.max(openingOffer, floor));
    publicEvents.push({
      type: "offer",
      actor: "找房 AI",
      title: `提出 ${money(openingOffer)}/月`,
      detail: "同时确认押金、物业费、网费和水电计价。"
    });
    if (agreedRent !== openingOffer) {
      publicEvents.push({
        type: "counteroffer",
        actor: "出租 AI",
        title: `还价至 ${money(agreedRent)}/月`,
        detail: "该价格仍在你的私密授权范围内。"
      });
    }
  } else if (listing.minRent <= mandate.budget.hardMax) {
    agreedRent = listing.minRent;
    publicEvents.push({
      type: "offer",
      actor: "找房 AI",
      title: `提出 ${money(mandate.budget.target)}/月`,
      detail: "没有向对方披露你的最高预算。"
    });
    publicEvents.push({
      type: "counteroffer",
      actor: "出租 AI",
      title: `还价至 ${money(listing.minRent)}/月`,
      detail: "价格落在预先授权范围内。"
    });
  }

  if (agreedRent !== null && agreedRent <= mandate.budget.hardMax) {
    publicEvents.push({
      type: "tentative_agreement",
      actor: "双方 AI",
      title: `形成非约束性意向：${money(agreedRent)}/月`,
      detail: "需双方本人确认并核验原件后才进入看房或签约。"
    });
    return { status: "tentative_agreement", agreedRent, agreementLabel, publicEvents };
  }

  publicEvents.push({
    type: "rejection",
    actor: "找房 AI",
    title: "停止议价",
    detail: "双方授权范围没有交集，未继续加价。"
  });
  return { status: "rejected", agreedRent: null, agreementLabel: "", publicEvents };
}

function unknownFacts(listing) {
  const unknown = [];
  if (listing.facilities?.utilities === "unknown") unknown.push("水电计价");
  if (listing.facilities?.washerType === "unknown") unknown.push("洗衣机类型");
  if (listing.fees?.propertyMonthly === null) unknown.push("物业费");
  if (listing.fees?.networkMonthly === null) unknown.push("网费");
  return unknown;
}

function preferenceScore(mandate, listing, agreedRent, unknown) {
  let score = 100;
  score -= listing.commuteMinutes * 0.28;
  score -= Math.max(0, agreedRent - mandate.budget.target) / 35;
  if (listing.facilities?.ensuite) score += 4;
  if (listing.facilities?.elevator) score += 1.5;
  if (listing.facilities?.exposure === "south") score += 1.5;
  if (listing.facilities?.washerType === "drum") score += 1;
  score -= unknown.length * 3.5;
  return Math.round(clamp(score, 0, 98));
}

function buildReasons(mandate, listing, agreedRent) {
  const reasons = [];
  reasons.push(`${listing.commuteMinutes} 分钟到目标地点，未超过 ${mandate.maxCommuteMinutes} 分钟上限`);
  reasons.push(`价格已确认到 ${money(agreedRent)}/月`);
  if (listing.facilities?.ensuite) reasons.push("独立卫生间命中加分偏好");
  if (listing.facilities?.exposure === "south") reasons.push("朝南采光命中偏好");
  if (listing.facilities?.washerType === "drum") reasons.push("滚筒洗衣机命中偏好");
  return reasons.slice(0, 3);
}

function buildCaveats(mandate, listing, agreedRent, unknown) {
  const caveats = [];
  if (!listing.facilities?.elevator) caveats.push(`${listing.room.floor} 楼无电梯`);
  if (!listing.facilities?.ensuite) caveats.push("卫生间需与室友共用");
  if (listing.facilities?.exposure !== "south") caveats.push("不是朝南房间");
  if (agreedRent > mandate.budget.target) caveats.push(`比目标预算高 ${money(agreedRent - mandate.budget.target)}`);
  if (unknown.length) caveats.push(`${unknown.join("、")}尚未确认`);
  return caveats;
}

function provenanceFor(listing, agreedRent) {
  return [
    { label: "身份与发布角色", value: listing.publisher, source: "平台核验" },
    { label: "出租或转租权", value: "材料一致", source: "平台核验" },
    { label: "当前意向租金", value: `${money(agreedRent)}/月`, source: "AI 协商确认" },
    {
      label: "房屋现场信息",
      value: listing.verification.liveSite === "partial" ? "部分待确认" : "当天有效",
      source: listing.verification.liveSite === "partial" ? "尚未确认" : "实时核验"
    }
  ];
}

export function evaluateListing(mandate, listing) {
  const integrity = integrityAssessment(listing);
  if (integrity.disposition !== "continue") {
    return {
      listing,
      status: integrity.disposition,
      reasonCodes: integrity.reasons,
      reasonLabels: integrity.reasons.map((reason) => reasonLabels[reason])
    };
  }

  const hardFailures = hardConstraintAssessment(mandate, listing);
  if (hardFailures.length) {
    return {
      listing,
      status: "excluded",
      reasonCodes: hardFailures,
      reasonLabels: hardFailures.map((reason) => reasonLabels[reason])
    };
  }

  const negotiation = negotiate(mandate, listing);
  if (negotiation.status !== "tentative_agreement") {
    return {
      listing,
      status: "excluded",
      reasonCodes: ["budget"],
      reasonLabels: [reasonLabels.budget],
      negotiation
    };
  }

  const unknown = unknownFacts(listing);
  const score = preferenceScore(mandate, listing, negotiation.agreedRent, unknown);
  return {
    listing,
    status: "eligible",
    score,
    agreedRent: negotiation.agreedRent,
    agreementLabel: negotiation.agreementLabel,
    unknownFacts: unknown,
    reasons: buildReasons(mandate, listing, negotiation.agreedRent),
    caveats: buildCaveats(mandate, listing, negotiation.agreedRent, unknown),
    provenance: provenanceFor(listing, negotiation.agreedRent),
    negotiation
  };
}

function amenityStrength(result) {
  const facilities = result.listing.facilities;
  return Number(facilities.ensuite) * 4 + Number(facilities.elevator) * 2 + Number(facilities.exposure === "south");
}

export function selectDiversifiedCandidates(eligible, limit = 3) {
  const remaining = [...eligible];
  const picked = [];

  const take = (sorter, label) => {
    const available = remaining.filter((item) => !picked.some((pickedItem) => pickedItem.listing.id === item.listing.id));
    if (!available.length || picked.length >= limit) return;
    const selected = available.sort(sorter)[0];
    picked.push({ ...selected, selectionLabel: label });
  };

  take((a, b) => b.score - a.score, "综合最合适");
  take((a, b) => a.agreedRent - b.agreedRent || b.score - a.score, "预算最轻");
  take((a, b) => amenityStrength(b) - amenityStrength(a) || b.score - a.score, "居住条件最好");

  return picked;
}

export function matchMandate(mandate, candidateListings, options = {}) {
  const startedAt = options.startedAt || `${SIMULATION_DATE}T10:20:00+08:00`;
  const evaluated = candidateListings.map((listing) => evaluateListing(mandate, listing));
  const eligible = evaluated.filter((result) => result.status === "eligible");
  const quarantined = evaluated.filter((result) => result.status === "quarantine");
  const excluded = evaluated.filter((result) => result.status === "excluded");
  const candidates = selectDiversifiedCandidates(eligible, 3);

  const audit = [
    {
      at: startedAt,
      actor: "平台",
      type: "scan",
      title: `扫描 ${candidateListings.length} 套房源`,
      detail: "先核验发布角色、出租权、费用清单与房源时效。"
    },
    ...quarantined.map((result) => ({
      at: startedAt,
      actor: "风控",
      type: "quarantine",
      title: `隔离：${result.listing.shortTitle}`,
      detail: result.reasonLabels.join("；")
    })),
    ...excluded.slice(0, 4).map((result) => ({
      at: startedAt,
      actor: "匹配 AI",
      type: "exclude",
      title: `排除：${result.listing.shortTitle}`,
      detail: result.reasonLabels.join("；")
    })),
    {
      at: startedAt,
      actor: "匹配 AI",
      type: "deliver",
      title: candidates.length ? `交付 ${candidates.length} 套候选` : "本轮没有合适候选",
      detail: candidates.length ? "按综合、预算与居住条件去重后交付。" : "AI 没有为了凑数放宽硬性要求。"
    }
  ];

  return {
    mandateId: mandate.id,
    scanned: candidateListings.length,
    eligibleCount: eligible.length,
    excludedCount: excluded.length,
    quarantinedCount: quarantined.length,
    candidates,
    eligible,
    excluded,
    quarantined,
    audit
  };
}

export function validateSupplyDraft(draft) {
  const errors = [];
  const warnings = [];

  if (!ALLOWED_SUPPLY_ROLES.has(draft.role)) errors.push("只允许产权人直租或当前承租人个人转租");
  if (!draft.address?.trim()) errors.push("需要完整地址用于平台核验");
  if (!Number.isFinite(Number(draft.listedRent)) || Number(draft.listedRent) <= 0) errors.push("租金必须是有效金额");
  if (!draft.availableFrom) errors.push("需要填写可入住日期");
  else if (compareDate(draft.availableFrom, SIMULATION_DATE) < 0) errors.push("可入住日期不能早于今天");
  const prohibitedFeeKeys = ["service", "intermediary", "information", "viewing", "signing"];
  if (prohibitedFeeKeys.some((key) => Number(draft.fees?.[key] || 0) > 0)) {
    errors.push("不得收取中介费、服务费、信息费或带看费");
  }
  if (!draft.evidence?.identity) errors.push("身份核验未完成");
  if (!draft.evidence?.roleDocument) errors.push("发布角色材料未完成");
  if (!draft.evidence?.rightsDocument) errors.push("产权或在租合同材料未完成");
  if (!draft.evidence?.livePhotoChallenge) errors.push("房屋现场随机拍摄未完成");
  if (!draft.facilities?.washer) warnings.push("洗衣机信息缺失会降低匹配质量");
  if (!draft.facilities?.kitchen) warnings.push("厨房信息缺失会降低匹配质量");

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    badge: errors.length === 0 ? "四项核验完成" : "暂不可发布"
  };
}

function listingFromSupplyDraft(draft, mandate, index) {
  const requestedNearListing = (mandate.locations || []).some((place) => {
    const wanted = normalizePlace(place);
    return [draft.location, draft.station, draft.district, draft.address]
      .map(normalizePlace)
      .some((candidate) => candidate && (candidate.includes(wanted) || wanted.includes(candidate)));
  });

  return {
    id: `draft-${draft.role || "supply"}`,
    title: draft.title,
    shortTitle: draft.title,
    role: draft.role,
    claimedRole: draft.role,
    publisher: draft.role === "landlord" ? "房东本人" : "当前租客",
    district: draft.district || "静安区",
    location: draft.location || "静安寺",
    station: draft.station || "静安寺站",
    walkMinutes: 8,
    commuteMinutes: requestedNearListing ? 18 + (index % 3) * 4 : 55,
    addressHint: draft.address,
    listedRent: Number(draft.listedRent),
    minRent: Number(draft.minimumAuthorizedRent || draft.listedRent),
    depositMonths: Math.max(1, Math.round(Number(draft.fees?.deposit || draft.listedRent) / Number(draft.listedRent || 1))),
    availableFrom: draft.availableFrom,
    leaseMonthsMin: 12,
    conditionalOffers: [],
    room: {
      areaSqm: 15,
      floor: 9,
      totalFloors: 18,
      roommateCount: Number(draft.roommateCount || 0),
      roommateGender: draft.roommateGender || null
    },
    facilities: {
      kitchen: Boolean(draft.facilities?.kitchen),
      washer: Boolean(draft.facilities?.washer),
      washerType: "drum",
      elevator: Boolean(draft.facilities?.elevator),
      ensuite: Boolean(draft.facilities?.ensuite),
      exposure: draft.facilities?.exposure || "unknown",
      utilities: "residential"
    },
    fees: {
      service: Number(draft.fees?.service || 0),
      intermediary: Number(draft.fees?.intermediary || 0),
      information: Number(draft.fees?.information || 0),
      viewing: Number(draft.fees?.viewing || 0),
      signing: Number(draft.fees?.signing || 0),
      propertyMonthly: Number(draft.fees?.property || 0),
      networkMonthly: Number(draft.fees?.network || 0)
    },
    verification: {
      identity: draft.evidence?.identity ? "verified" : "missing",
      role: draft.evidence?.roleDocument ? "verified" : "missing",
      rights: draft.evidence?.rightsDocument ? "verified" : "missing",
      liveSite: draft.evidence?.livePhotoChallenge ? "verified" : "unverified"
    },
    lastVerifiedDays: 0,
    freshness: "live",
    evidence: { duplicatePhoto: false, feeMessage: false, roleConflict: false }
  };
}

export function matchSupplyDraft(draft, cases = tenantCases) {
  const validation = validateSupplyDraft(draft);
  if (!validation.valid) {
    return { scanned: 0, eligibleCount: 0, candidates: [], excluded: [], audit: [], validation };
  }

  const evaluated = cases.map((tenant, index) => {
    const result = evaluateListing(tenant.mandate, listingFromSupplyDraft(draft, tenant.mandate, index));
    return { ...result, tenant };
  });
  const eligible = evaluated
    .filter((item) => item.status === "eligible")
    .sort((a, b) => b.score - a.score);
  const excluded = evaluated.filter((item) => item.status !== "eligible");
  const candidates = eligible.slice(0, 3).map((item, index) => ({
    tenant: item.tenant,
    agreedRent: item.agreedRent,
    score: item.score,
    reasons: item.reasons,
    caveats: item.caveats,
    negotiation: item.negotiation,
    selectionLabel: ["条件最稳", "入住最快", "价格合适"][index] || "可继续"
  }));

  return {
    scanned: cases.length,
    eligibleCount: eligible.length,
    candidates,
    eligible,
    excluded,
    validation,
    audit: [
      { actor: "平台", title: `读取 ${cases.length} 份找房委托`, detail: "逐项比较区域、入住日、合租、租期、设施与预算。" },
      ...excluded.slice(0, 4).map((item) => ({
        actor: "匹配 AI",
        title: `未继续：${item.tenant.alias}`,
        detail: item.reasonLabels?.join("；") || "双方授权范围没有交集"
      })),
      { actor: "匹配 AI", title: `整理 ${candidates.length} 位候选租客`, detail: "只交付硬条件无冲突且价格能够形成意向的候选。" }
    ]
  };
}

export function evaluateReport({ listing, reportType, reporterEvidence = {} }) {
  const objectiveEvidence =
    listing.evidence?.feeMessage ||
    listing.evidence?.roleConflict ||
    reporterEvidence.inAppFeeMessage ||
    reporterEvidence.verifiedDocumentConflict;

  if (reportType === "broker_or_fee" && objectiveEvidence) {
    return {
      status: "identity_banned",
      immediateAction: "房源已下架，账号与关联房源已冻结",
      finalAction: "客观证据确认后，实名主体永久禁止再次发布",
      appealAvailable: true
    };
  }

  return {
    status: "quarantined_pending_review",
    immediateAction: "房源已暂时隔离，不再进入新匹配",
    finalAction: "证据复核前不执行不可逆的永久封禁",
    appealAvailable: true
  };
}

function auditContainsPrivateCeiling(result, mandate) {
  const serialized = JSON.stringify(result.audit);
  return serialized.includes(`最高预算${mandate.budget.hardMax}`) || serialized.includes(`hardMax`);
}

export function runRegressionSuite() {
  const byId = (id) => listings.find((listing) => listing.id === id);
  const full = matchMandate(baseMandate, listings);
  const conditional = evaluateListing(baseMandate, byId("home-nanyang"));
  const broker = evaluateListing(baseMandate, byId("home-broker-trap"));
  const stale = evaluateListing(baseMandate, byId("home-stale"));
  const gender = evaluateListing(baseMandate, byId("home-male-roommates"));
  const overBudget = evaluateListing(baseMandate, byId("home-over-budget"));
  const unknown = evaluateListing(baseMandate, byId("home-unknown-utilities"));
  const provenReport = evaluateReport({ listing: byId("home-broker-trap"), reportType: "broker_or_fee" });
  const unprovenReport = evaluateReport({ listing: byId("home-jiangsu"), reportType: "broker_or_fee" });
  const badSupply = validateSupplyDraft({
    ...demoSupplyDraft,
    fees: { ...demoSupplyDraft.fees, service: 500 }
  });

  const cases = [
    ["房东直租可进入候选", full.eligible.some((item) => item.listing.role === "landlord")],
    ["个人转租可进入候选", full.eligible.some((item) => item.listing.role === "subletter")],
    ["3,200 元可按授权条件谈到 3,000 元", conditional.status === "eligible" && conditional.agreedRent === 3000],
    ["中介伪装立即隔离", broker.status === "quarantine"],
    ["过期房源不参与匹配", stale.status === "excluded" && stale.reasonCodes.includes("stale")],
    ["室友性别硬冲突被排除", gender.status === "excluded" && gender.reasonCodes.includes("roommate_gender")],
    ["AI 不越过私密最高预算", overBudget.status === "excluded" && overBudget.reasonCodes.includes("budget")],
    ["未知关键信息必须显式展示", unknown.status === "eligible" && unknown.unknownFacts.length >= 3],
    ["审计摘要不泄露私密最高预算", !auditContainsPrivateCeiling(full, baseMandate)],
    ["站内客观收费证据触发实名级封禁", provenReport.status === "identity_banned"],
    ["单次无证据举报不会直接永久封禁", unprovenReport.status === "quarantined_pending_review"],
    ["发布端拒绝任何服务费", badSupply.valid === false && badSupply.errors.some((item) => item.includes("服务费"))],
    ["候选最多三套且做差异化去重", full.candidates.length === 3 && new Set(full.candidates.map((item) => item.selectionLabel)).size === 3]
  ];

  return cases.map(([name, passed], index) => ({ id: `reg-${index + 1}`, name, passed: Boolean(passed) }));
}

export function runLabScenario(scenarioId, mandate = baseMandate) {
  const scenario = labScenarios.find((item) => item.id === scenarioId) || labScenarios[0];
  return {
    scenario,
    result: matchMandate(mandate, getListingsByIds(scenario.listingIds))
  };
}
