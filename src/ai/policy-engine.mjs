const PRIVATE_TERMS = ["private_min", "private_max", "max_budget", "hardMax", "底价", "最低授权", "最高预算", "预算上限"];
const CITY_ALIASES = new Map([
  ["上海", "shanghai"],
  ["上海市", "shanghai"],
  ["shanghai", "shanghai"],
  ["北京", "beijing"],
  ["北京市", "beijing"],
  ["beijing", "beijing"],
  ["广州", "guangzhou"],
  ["广州市", "guangzhou"],
  ["guangzhou", "guangzhou"],
  ["深圳", "shenzhen"],
  ["深圳市", "shenzhen"],
  ["shenzhen", "shenzhen"]
]);

function normalizeCity(value) {
  const city = String(value || "").trim().toLowerCase();
  return CITY_ALIASES.get(city) || city.replace(/市$/, "");
}

function normalizePlace(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s·・,，]/g, "")
    .replace(/地铁站|地铁|附近|周边|站$/g, "");
}

function locationsOverlap(renter, listing) {
  const wanted = (renter?.locations || []).map(normalizePlace).filter(Boolean);
  if (!wanted.length) return true;
  const offered = [listing?.location, listing?.station].map(normalizePlace).filter(Boolean);
  if (!offered.length) return false;
  return wanted.some((left) => offered.some((right) => left.includes(right) || right.includes(left)));
}

function addUnique(items, value) {
  if (!items.includes(value)) items.push(value);
}

function dateAfter(left, right) {
  if (!left || !right) return false;
  return Date.parse(`${left}T00:00:00Z`) > Date.parse(`${right}T23:59:59Z`);
}

export function enforceEvaluation(renter, listing, rawEvaluation = {}) {
  const policyConflicts = [];
  const unknowns = Array.isArray(rawEvaluation.unknowns) ? [...rawEvaluation.unknowns] : [];
  let needsNegotiation = Boolean(rawEvaluation.needs_negotiation);

  if (!listing) addUnique(policyConflicts, "listing_missing");
  if (renter?.city && listing?.city && normalizeCity(renter.city) !== normalizeCity(listing.city)) addUnique(policyConflicts, "city");
  if (!locationsOverlap(renter, listing)) addUnique(policyConflicts, "location");

  if (renter?.publisher_role === "landlord" && listing?.role !== "landlord") addUnique(policyConflicts, "publisher_role");
  if (renter?.publisher_role === "subletter" && listing?.role !== "subletter") addUnique(policyConflicts, "publisher_role");

  if (renter?.housing?.shared === false && listing?.housing?.shared !== false) addUnique(policyConflicts, "shared_housing");
  if (
    renter?.housing?.roommate_gender &&
    listing?.housing?.shared === true &&
    listing?.housing?.roommate_gender !== renter.housing.roommate_gender
  ) {
    addUnique(policyConflicts, "roommate_gender");
  }

  const maxBudget = Number(renter?.budget?.max);
  const listedRent = Number(listing?.listed_rent);
  const privateMinRent = Number(listing?.private_min_rent);
  if (Number.isFinite(maxBudget) && Number.isFinite(listedRent) && listedRent > maxBudget) {
    if (!Number.isFinite(privateMinRent) || privateMinRent > maxBudget) addUnique(policyConflicts, "budget");
    else needsNegotiation = true;
  }

  if (dateAfter(listing?.available_from, renter?.move_in?.to)) addUnique(policyConflicts, "move_in");

  const hardFacilities = ["elevator", "ensuite", "kitchen", "washer", "residential_utilities", "pet_allowed"];
  hardFacilities.forEach((field) => {
    if (renter?.hard?.[field] !== true) return;
    if (listing?.facilities?.[field] !== true) addUnique(policyConflicts, field);
  });

  const modelConflicts = Array.isArray(rawEvaluation.hard_conflicts) ? rawEvaluation.hard_conflicts : [];
  const hardConflicts = [...new Set([...modelConflicts, ...policyConflicts])];
  const eligible = Boolean(rawEvaluation.eligible) && policyConflicts.length === 0;
  const safeEvidence = (rawEvaluation.evidence || []).filter((item) => !containsPrivateTerm(item));
  const rawPublicReason = String(rawEvaluation.public_reason || "");
  const labels = {
    city: "城市",
    location: "位置",
    publisher_role: "发布者角色",
    shared_housing: "整租/合租方式",
    roommate_gender: "室友性别",
    budget: "预算",
    move_in: "入住时间",
    elevator: "电梯",
    ensuite: "独卫",
    kitchen: "厨房",
    washer: "洗衣机",
    residential_utilities: "民水民电",
    pet_allowed: "宠物",
    listing_missing: "房源记录"
  };

  return {
    ...rawEvaluation,
    listing_id: rawEvaluation.listing_id || listing?.listing_id,
    eligible,
    hard_conflicts: hardConflicts,
    unknowns,
    preference_score: eligible ? Number(rawEvaluation.preference_score || 0) : 0,
    needs_negotiation: eligible ? needsNegotiation : false,
    public_reason: policyConflicts.length
      ? `不满足硬性条件：${policyConflicts.map((item) => labels[item] || item).join("、")}。`
      : containsPrivateTerm(rawPublicReason)
        ? eligible
          ? "已按硬性条件与公开房源事实完成检查。"
          : "公开条件不满足当前委托。"
        : rawPublicReason,
    evidence: [...new Set([...safeEvidence, ...(policyConflicts.length ? ["policy_engine"] : [])])]
  };
}

function containsPrivateTerm(value) {
  const text = JSON.stringify(value || "");
  return PRIVATE_TERMS.some((term) => text.includes(term));
}

export function publicTextHasPrivateTerm(value) {
  return containsPrivateTerm(value);
}

function safeEvent(event, status) {
  const fallbackAction = status === "tentative_agreement" ? "在授权范围内确认意向" : "确认当前授权范围无交集";
  return {
    actor: event?.actor === "supply_agent" ? "supply_agent" : "renter_agent",
    action: containsPrivateTerm(event?.action) ? fallbackAction : String(event?.action || fallbackAction),
    rent: Number.isFinite(Number(event?.rent)) ? Number(event.rent) : null,
    condition: containsPrivateTerm(event?.condition) ? null : event?.condition || null
  };
}

export function sanitizeNegotiations(rawNegotiations, pairs) {
  let leakCount = 0;
  const negotiations = (rawNegotiations || []).map((raw) => {
    const pair = pairs.find((item) => item.renter_id === raw.renter_id && item.listing_id === raw.listing_id);
    const agreedRent = Number(raw.agreed_rent);
    const withinBounds =
      raw.status === "tentative_agreement" &&
      pair &&
      Number.isFinite(agreedRent) &&
      agreedRent <= Number(pair.private_max_rent) &&
      agreedRent >= Number(pair.private_min_rent);
    const status = raw.status === "tentative_agreement" && !withinBounds ? "needs_human" : raw.status;
    if (raw.private_data_leaked || containsPrivateTerm({ public_events: raw.public_events, final_note: raw.final_note })) leakCount += 1;
    return {
      renter_id: raw.renter_id,
      listing_id: raw.listing_id,
      status,
      agreed_rent: withinBounds ? agreedRent : null,
      public_events: (raw.public_events || []).map((event) => safeEvent(event, status)),
      private_data_leaked: false,
      final_note:
        status === "tentative_agreement"
          ? "双方已在授权范围内形成非约束性价格意向，待本人确认。"
          : status === "no_agreement"
            ? "双方当前授权范围没有交集，协商已停止。"
            : "存在未获授权的条件，等待本人确认。"
    };
  });
  return { negotiations, leakCount };
}

export function enforceSelections({ selections, decisions, matches, negotiations }) {
  const allowed = new Set(decisions.filter((item) => item.decision === "allow").map((item) => item.listing_id));
  const evaluationByPair = new Map(
    matches.flatMap((match) =>
      (match.evaluations || []).map((evaluation) => [`${match.renter_id}:${evaluation.listing_id}`, evaluation])
    )
  );
  const agreementByPair = new Map(
    negotiations.map((item) => [`${item.renter_id}:${item.listing_id}`, item])
  );

  return selections.map((selection) => {
    const recommendations = (selection.recommendations || [])
      .filter((recommendation) => {
        const key = `${selection.renter_id}:${recommendation.listing_id}`;
        const evaluation = evaluationByPair.get(key);
        if (!allowed.has(recommendation.listing_id) || !evaluation?.eligible) return false;
        if (!evaluation.needs_negotiation) return true;
        return agreementByPair.get(key)?.status === "tentative_agreement";
      })
      .slice(0, 3)
      .map((recommendation, index) => ({
        ...recommendation,
        rank: index + 1,
        match_points: (recommendation.match_points || []).filter((item) => !containsPrivateTerm(item)),
        caveats: (recommendation.caveats || []).map((item) =>
          containsPrivateTerm(item) ? "挂牌价高于目标价，当前意向价格仍待本人确认。" : item
        ),
        verified_facts: (recommendation.verified_facts || []).filter((item) => !containsPrivateTerm(item)),
        headline: containsPrivateTerm(recommendation.headline) ? "已完成硬性条件核验" : recommendation.headline
      }));

    const rawSummary = String(selection.summary || "");
    const safeSummary = containsPrivateTerm(rawSummary)
      ? `找到 ${recommendations.length} 套满足硬性条件的候选，价格意向待本人确认。`
      : rawSummary;

    return {
      ...selection,
      status: recommendations.length ? "matched" : selection.status === "needs_clarification" ? "needs_clarification" : "no_fit",
      recommendations,
      summary: recommendations.length ? safeSummary : "当前没有同时满足硬性条件的房源。"
    };
  });
}

export const policyPrivateTerms = PRIVATE_TERMS;
