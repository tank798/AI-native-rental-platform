import { compareIsoDates } from "../clock.mjs";

export const PAIR_EVALUATOR_VERSION = "rules-0.7.0";

function normalizePlace(value) {
  return String(value || "")
    .replace(/(?:上海市|上海|市|区|县|地铁站|站|商圈|附近|周边|一带)/gu, "")
    .replace(/[\s·・]/gu, "")
    .trim();
}

function locationMatches(locations, draft) {
  const supplied = [draft.location, draft.station, draft.district]
    .map(normalizePlace)
    .filter(Boolean);
  return locations.some((location) => {
    const requested = normalizePlace(location);
    return requested && supplied.some((candidate) => candidate.includes(requested) || requested.includes(candidate));
  });
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function publicLocation(draft) {
  return [draft.district, draft.location, draft.station].filter(Boolean).join(" · ");
}

function leaseRange(mandate) {
  if (mandate.leaseFlexible && mandate.leaseMonthsRange) {
    return {
      min: numberOrNull(mandate.leaseMonthsRange.min),
      max: numberOrNull(mandate.leaseMonthsRange.max)
    };
  }
  const exact = numberOrNull(mandate.leaseMonths);
  return exact ? { min: exact, max: exact } : { min: null, max: null };
}

function verificationReady(draft) {
  const required = ["identity", "roleDocument", "rightsDocument", "livePhotoChallenge"];
  return required.every((key) => draft.verification?.[key]?.verificationStatus === "verified");
}

function renterCandidateProjection(draft, evaluation) {
  const routeMinutes = Object.values(draft.commuteMinutesByDestination || {})
    .map(numberOrNull)
    .filter((value) => value !== null);
  const projectedCommuteMinutes = routeMinutes.length ? Math.max(...routeMinutes) : numberOrNull(draft.commuteMinutes);
  return {
    counterpartyType: "task",
    matchCaseStatus: evaluation.status,
    score: evaluation.score,
    reasons: [...evaluation.publicReasons],
    caveats: evaluation.blockingUnknowns.map((item) => item.label),
    agreedRent: evaluation.termsProposal?.rent ?? null,
    provenance: [
      { label: "发布角色", value: draft.role === "landlord" ? "房东本人" : "当前租客", source: "人工审核" },
      { label: "粗粒度位置", value: publicLocation(draft), source: "发布方确认" }
    ],
    negotiation: { publicEvents: [] },
    listing: {
      title: String(draft.title || `${draft.location || ""}个人房源`),
      shortTitle: String(draft.title || `${draft.location || ""}个人房源`),
      role: draft.role,
      district: draft.district || null,
      location: draft.location || null,
      station: draft.station || null,
      walkMinutes: numberOrNull(draft.walkMinutes),
      commuteMinutes: projectedCommuteMinutes,
      addressHint: `${publicLocation(draft)} · 精确地址待双方确认`,
      listedRent: numberOrNull(draft.listedRent),
      availableFrom: draft.availableFrom || null,
      leaseMonthsMin: numberOrNull(draft.leaseMonthsMin),
      room: {
        areaSqm: numberOrNull(draft.areaSqm),
        floor: numberOrNull(draft.floor),
        totalFloors: numberOrNull(draft.totalFloors),
        roommateCount: numberOrNull(draft.roommateCount),
        roommateGender: draft.roommateGender || null
      },
      facilities: {
        kitchen: draft.facilities?.kitchen ?? null,
        washer: draft.facilities?.washer ?? null,
        elevator: draft.facilities?.elevator ?? null,
        ensuite: draft.facilities?.ensuite ?? null,
        exposure: draft.facilities?.exposure || "unknown"
      },
      fees: {
        service: 0,
        intermediary: 0,
        utilities: draft.fees?.utilities ?? null,
        network: draft.fees?.network ?? null,
        property: draft.fees?.property ?? null
      }
    }
  };
}

function supplyCandidateProjection(mandate, renterTask, evaluation) {
  return {
    counterpartyType: "task",
    matchCaseStatus: evaluation.status,
    score: evaluation.score,
    reasons: [...evaluation.publicReasons],
    caveats: evaluation.blockingUnknowns.map((item) => item.label),
    agreedRent: evaluation.termsProposal?.rent ?? null,
    displayAlias: `租客 ${String(renterTask.id).slice(0, 6)}`,
    tenant: {
      alias: `租客 ${String(renterTask.id).slice(0, 6)}`,
      occupation: "平台实名租客",
      mandate: {
        leaseMonths: mandate.leaseMonths ?? null,
        leaseFlexible: Boolean(mandate.leaseFlexible),
        leaseMonthsRange: mandate.leaseMonthsRange || null,
        moveInWindow: mandate.moveInWindow || null,
        sharedHousing: mandate.sharedHousing ?? null,
        roommateGender: mandate.roommateGender || null,
        maxCommuteMinutes: numberOrNull(mandate.maxCommuteMinutes)
      }
    }
  };
}

/** Pure, deterministic evaluation of one fixed renter/supply task version. */
export function evaluateTaskPair({
  renterTask,
  renterInputVersion,
  supplyTask,
  supplyInputVersion,
  evaluatedAt
}) {
  if (!renterTask || renterTask.kind !== "renter") throw new TypeError("renterTask must be a renter task");
  if (!supplyTask || supplyTask.kind !== "supply") throw new TypeError("supplyTask must be a supply task");
  if (!evaluatedAt) throw new TypeError("evaluatedAt is required");
  const mandate = renterTask.payload?.mandate || {};
  const draft = supplyTask.payload?.draft || {};
  const hardConflicts = [];
  const blockingUnknowns = [];
  const nonBlockingUnknowns = [];
  const publicReasons = [];
  const privateDiagnostics = [];

  const conflict = (code, publicLabel, privateDetail) => {
    hardConflicts.push({ code, label: publicLabel });
    privateDiagnostics.push({ code, detail: privateDetail });
  };
  const unknown = (fieldKey, targetParty, reasonCode, label) => {
    blockingUnknowns.push({ fieldKey, targetParty, reasonCode, label });
  };

  if (!mandate.city || !draft.city) unknown(!mandate.city ? "city" : "listing.city", !mandate.city ? "renter" : "supply", "CITY_UNKNOWN", "城市待确认");
  else if (mandate.city !== draft.city) conflict("CITY_MISMATCH", "城市不匹配", `renter=${mandate.city}; supply=${draft.city}`);

  if (!Array.isArray(mandate.locations) || !mandate.locations.length) unknown("targetLocations", "renter", "LOCATION_UNKNOWN", "居住区域待确认");
  else if (!draft.location && !draft.station && !draft.district) unknown("listing.location", "supply", "LOCATION_UNKNOWN", "房源区域待确认");
  else if (!locationMatches(mandate.locations, draft)) conflict("LOCATION_MISMATCH", "居住区域不匹配", "requested locations do not intersect supplied area");
  else publicReasons.push("居住区域符合");

  const commuteDestinations = Array.isArray(mandate.commuteDestinations) ? mandate.commuteDestinations : [];
  if (commuteDestinations.length) {
    const routeMinutes = commuteDestinations.map((destination) => numberOrNull(draft.commuteMinutesByDestination?.[destination] ?? draft.commuteMinutes));
    if (routeMinutes.some((minutes) => minutes === null)) unknown("commute.routeMinutes", "supply", "COMMUTE_ROUTE_UNKNOWN", "通勤路线待计算");
    else if (Math.max(...routeMinutes) > Number(mandate.maxCommuteMinutes)) conflict("COMMUTE_EXCEEDS_LIMIT", "通勤时间超出要求", `route=${Math.max(...routeMinutes)}; limit=${mandate.maxCommuteMinutes}`);
    else publicReasons.push("通勤时间符合");
  }

  const hardMax = numberOrNull(mandate.budget?.hardMax);
  const minimumRent = numberOrNull(draft.minimumAuthorizedRent);
  const listedRent = numberOrNull(draft.listedRent);
  if (hardMax === null) unknown("budget.hardMax", "renter", "BUDGET_UNKNOWN", "可接受价格待确认");
  if (minimumRent === null || listedRent === null) unknown("listing.rent", "supply", "RENT_UNKNOWN", "房源价格待确认");
  if (hardMax !== null && minimumRent !== null) {
    if (hardMax < minimumRent) conflict("PRICE_NO_INTERSECTION", "双方授权价格无交集", `renter hard max=${hardMax}; supply minimum=${minimumRent}`);
    else publicReasons.push("授权价格存在交集");
  }

  const renterLease = leaseRange(mandate);
  const supplyLeaseMin = numberOrNull(draft.leaseMonthsMin);
  if (renterLease.max === null) unknown("leaseMonths", "renter", "LEASE_UNKNOWN", "租期待确认");
  if (supplyLeaseMin === null) unknown("listing.leaseMonthsMin", "supply", "LEASE_UNKNOWN", "起租期待确认");
  if (renterLease.max !== null && supplyLeaseMin !== null && renterLease.max < supplyLeaseMin) {
    conflict("LEASE_NO_INTERSECTION", "租期无交集", `renter max=${renterLease.max}; supply min=${supplyLeaseMin}`);
  }

  const moveIn = mandate.moveInWindow;
  if (!moveIn?.from || !moveIn?.to) unknown("moveInWindow", "renter", "MOVE_IN_UNKNOWN", "入住日期待确认");
  if (!draft.availableFrom) unknown("listing.availableFrom", "supply", "MOVE_IN_UNKNOWN", "可入住日期待确认");
  if (moveIn?.to && draft.availableFrom && compareIsoDates(draft.availableFrom, moveIn.to) > 0) {
    conflict("MOVE_IN_NO_INTERSECTION", "入住日期无交集", `renter to=${moveIn.to}; supply from=${draft.availableFrom}`);
  }

  const roommateCount = numberOrNull(draft.roommateCount) ?? 0;
  if (mandate.sharedHousing === false && roommateCount > 0) conflict("HOUSING_MODE_MISMATCH", "整租与合租要求冲突", `roommates=${roommateCount}`);
  if (mandate.roommateGender && roommateCount > 0 && !draft.roommateGender) unknown("listing.roommateGender", "supply", "ROOMMATE_GENDER_UNKNOWN", "室友性别待确认");
  else if (mandate.roommateGender && draft.roommateGender && mandate.roommateGender !== draft.roommateGender) {
    conflict("ROOMMATE_GENDER_MISMATCH", "室友条件不匹配", `requested=${mandate.roommateGender}; actual=${draft.roommateGender}`);
  }

  for (const key of ["kitchen", "washer", "ensuite", "elevator"]) {
    if (!mandate.hardConstraints?.[key]) continue;
    const supplied = draft.facilities?.[key];
    const label = { kitchen: "厨房", washer: "洗衣机", ensuite: "独立卫生间", elevator: "电梯" }[key];
    if (supplied === null || supplied === undefined) unknown(`listing.facilities.${key}`, "supply", "REQUIRED_FACILITY_UNKNOWN", `${label}信息待确认`);
    else if (supplied === false) conflict("REQUIRED_FACILITY_MISSING", "必须设施不符合", `facility=${key}`);
  }

  const prohibitedFees = ["service", "intermediary", "information", "viewing", "signing"];
  if (prohibitedFees.some((key) => Number(draft.fees?.[key] || 0) > 0)) conflict("PROHIBITED_FEE", "房源存在禁止费用", "one or more prohibited fees are positive");
  if (!verificationReady(draft)) conflict("SUPPLY_NOT_VERIFIED", "房源发布资格不可用", "one or more verification facts are not verified");

  const proposedRent = hardMax !== null && minimumRent !== null && listedRent !== null && hardMax >= minimumRent
    ? Math.max(minimumRent, Math.min(listedRent, hardMax))
    : null;
  const utilities = draft.fees?.utilities;
  if ((utilities === null || utilities === undefined || utilities === "" || utilities === "unknown") && proposedRent !== null && hardMax - proposedRent < 300) {
    unknown("listing.fees.utilities", "supply", "TOTAL_COST_BLOCKING_UNKNOWN", "水电费用待确认");
  }

  let score = 100;
  if (mandate.preferences?.exposure && mandate.preferences.exposure !== "any") {
    const wanted = String(mandate.preferences.exposure).replace(/_preferred$/u, "");
    if (!draft.facilities?.exposure || draft.facilities.exposure === "unknown") {
      nonBlockingUnknowns.push({ fieldKey: "listing.facilities.exposure", targetParty: "supply", label: "朝向待确认" });
      score -= 4;
    } else if (draft.facilities.exposure !== wanted) score -= 8;
    else publicReasons.push("朝向偏好符合");
  }

  const status = hardConflicts.length ? "hard_conflict" : blockingUnknowns.length ? "clarifying" : "eligible";
  const leaseMonths = supplyLeaseMin === null || renterLease.max === null
    ? null
    : Math.max(supplyLeaseMin, renterLease.min || supplyLeaseMin);
  const termsProposal = status === "hard_conflict" ? null : {
    rent: proposedRent,
    leaseMonths,
    moveInWindow: moveIn?.from && moveIn?.to && draft.availableFrom
      ? { from: compareIsoDates(draft.availableFrom, moveIn.from) > 0 ? draft.availableFrom : moveIn.from, to: moveIn.to }
      : null,
    feeSummary: {
      service: 0,
      intermediary: 0,
      utilitiesPolicy: utilities ?? "unknown"
    },
    approximateLocation: publicLocation(draft),
    viewingAvailability: draft.viewingAvailability || "any"
  };

  const core = {
    eligible: status === "eligible",
    status,
    hardConflicts,
    blockingUnknowns,
    nonBlockingUnknowns,
    score: Math.max(0, score),
    publicReasons: [...new Set(publicReasons)],
    privateDiagnostics,
    termsProposal,
    renterInputVersion: Number(renterInputVersion),
    supplyInputVersion: Number(supplyInputVersion),
    evaluatedAt,
    evaluatorVersion: PAIR_EVALUATOR_VERSION
  };
  return {
    ...core,
    renterCandidateProjection: renterCandidateProjection(draft, core),
    supplyCandidateProjection: supplyCandidateProjection(mandate, renterTask, core)
  };
}
