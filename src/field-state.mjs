function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function versionOf(field) {
  return Number(field?.version || 0);
}

export function applyFieldProposal(current, proposal) {
  if (current?.confirmationStatus === "user_confirmed") {
    if (sameValue(current.value, proposal.value)) return { ...current, conflictSuggestion: null };
    return {
      ...current,
      conflictSuggestion: {
        value: structuredClone(proposal.value),
        source: proposal.source || "ai",
        confidence: proposal.confidence ?? null
      }
    };
  }
  return {
    value: structuredClone(proposal.value),
    source: proposal.source || "ai",
    confidence: proposal.confidence ?? null,
    confirmationStatus: "proposed",
    version: versionOf(current) + 1,
    conflictSuggestion: null
  };
}

export function confirmField(current, userValue) {
  return {
    value: structuredClone(userValue),
    source: "user",
    confidence: 1,
    confirmationStatus: "user_confirmed",
    version: versionOf(current) + 1,
    conflictSuggestion: null
  };
}

export function resolveFieldValue(field) {
  return field?.value ?? null;
}

export function diffFieldVersions(before = {}, after = {}) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys
    .filter((fieldKey) => versionOf(before[fieldKey]) !== versionOf(after[fieldKey])
      || !sameValue(resolveFieldValue(before[fieldKey]), resolveFieldValue(after[fieldKey])))
    .map((fieldKey) => ({
      fieldKey,
      beforeVersion: versionOf(before[fieldKey]),
      afterVersion: versionOf(after[fieldKey]),
      beforeValue: resolveFieldValue(before[fieldKey]),
      afterValue: resolveFieldValue(after[fieldKey])
    }));
}
