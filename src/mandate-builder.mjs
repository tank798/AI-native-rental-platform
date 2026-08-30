function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueTextList(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(/(?:、|\/|，|,)/u);
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

/** Uses parser output once to prefill editable controls; it never builds a task. */
export function seedAnswersFromParsed(parsed, currentAnswers = {}) {
  const fields = parsed?.fields || {};
  const answers = { ...currentAnswers };
  if (fields.city) answers.city = fields.city;
  if (fields.locations?.length) answers.location = fields.locations.join(" / ");
  if (fields.commuteDestinations?.length) answers.commuteDestinations = [...fields.commuteDestinations];
  if (fields.budget?.target) answers.budgetMin = String(fields.budget.target);
  if (fields.budget?.hardMax) answers.budgetMax = String(fields.budget.hardMax);
  if (fields.moveInWindow?.from) answers.moveInFrom = fields.moveInWindow.from;
  if (fields.moveInWindow?.to) answers.moveInTo = fields.moveInWindow.to;
  if (fields.maxCommuteMinutes) answers.commute = String(fields.maxCommuteMinutes);
  if (fields.leaseMonths) answers.leaseMonths = String(fields.leaseMonths);
  if (fields.sharedHousing === false) answers.roommate = "no_share";
  if (fields.sharedHousing === true) answers.roommate = fields.roommateGender || "any";
  if (fields.preferences?.ensuite) answers.bathroom = fields.preferences.ensuite;
  if (fields.preferences?.elevator) answers.elevator = fields.preferences.elevator;
  if (fields.preferences?.utilities) answers.utilities = fields.preferences.utilities;
  if (fields.preferences?.floor) answers.floor = fields.preferences.floor;
  if (fields.preferences?.exposure) answers.exposure = fields.preferences.exposure;
  if (fields.preferences?.network) answers.network = fields.preferences.network;
  if (fields.preferences?.washerType) answers.washerType = fields.preferences.washerType;
  if (fields.viewingAvailability) answers.viewing = fields.viewingAvailability;
  if (fields.facilities?.kitchen !== null && fields.facilities?.kitchen !== undefined) {
    answers.kitchen = fields.facilities.kitchen ? "required" : "any";
  }
  if (fields.facilities?.washer !== null && fields.facilities?.washer !== undefined) {
    answers.washer = fields.facilities.washer ? "required" : "any";
  }
  return answers;
}

/**
 * Builds the canonical renter mandate exclusively from editable, confirmed
 * controls. `baseMandate` contributes invariant policy only, never user facts.
 */
export function buildMandateFromConfirmedAnswers({
  answers,
  selectedLocations = [],
  city = null,
  baseMandate = {}
}) {
  const locations = uniqueTextList(selectedLocations.length ? selectedLocations : answers?.location);
  const leaseFlexible = answers?.leaseMonths === "any";
  const roommate = answers?.roommate || "any";
  const sharedHousing = roommate === "no_share" ? false : roommate === "any" ? null : true;
  const exposure = answers?.exposure || "any";
  const washerType = answers?.washerType || "any";

  return {
    id: baseMandate.id || null,
    intent: baseMandate.intent || "rent",
    city: city || answers?.city || null,
    locations,
    targetLocations: [...locations],
    commuteDestinations: uniqueTextList(answers?.commuteDestinations),
    maxCommuteMinutes: numberOrNull(answers?.commute),
    budget: {
      target: numberOrNull(answers?.budgetMin),
      hardMax: numberOrNull(answers?.budgetMax),
      targetIsPrivate: true,
      hardMaxIsPrivate: true
    },
    moveInWindow: {
      from: answers?.moveInFrom || null,
      to: answers?.moveInTo || null
    },
    leaseMonths: leaseFlexible ? null : numberOrNull(answers?.leaseMonths),
    leaseFlexible,
    leaseMonthsRange: leaseFlexible ? { min: 3, max: 12 } : null,
    roomType: sharedHousing === false ? "entire_place" : sharedHousing === true ? "private_room" : "any",
    sharedHousing,
    roommateGender: ["female", "male"].includes(roommate) ? roommate : null,
    hardConstraints: {
      kitchen: answers?.kitchen === "required",
      washer: answers?.washer === "required",
      ensuite: answers?.bathroom === "required",
      elevator: answers?.elevator === "required",
      noBrokerOrServiceFee: baseMandate.hardConstraints?.noBrokerOrServiceFee !== false
    },
    preferences: {
      ensuite: answers?.bathroom || "any",
      elevator: answers?.elevator || "any",
      utilities: answers?.utilities || "any",
      floor: answers?.floor || "any",
      exposure: exposure === "any" ? "any" : `${exposure}_preferred`,
      washerType: washerType === "any" ? "any" : `${washerType}_preferred`,
      network: answers?.network || "any"
    },
    viewingAvailability: answers?.viewing || "any",
    negotiationAuthority: {
      mayOfferTarget: baseMandate.negotiationAuthority?.mayOfferTarget !== false,
      mayAcceptUpToHardMax: baseMandate.negotiationAuthority?.mayAcceptUpToHardMax !== false,
      mayTradeLeaseLength: baseMandate.negotiationAuthority?.mayTradeLeaseLength !== false,
      mayTradeMoveInDate: baseMandate.negotiationAuthority?.mayTradeMoveInDate !== false,
      binding: false
    }
  };
}
