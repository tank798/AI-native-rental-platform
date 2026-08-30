const MARKET_MODES = new Set(["real", "demo"]);

function optionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

/**
 * Normalizes the marketplace mode before any service starts.
 * `real` only uses persisted user tasks; `demo` may add fixture candidates.
 */
export function normalizeMarketMode(value = "real") {
  const normalized = String(value || "real").trim().toLowerCase();
  if (!MARKET_MODES.has(normalized)) {
    throw new Error("MARKET_MODE 只能是 real 或 demo");
  }
  return normalized;
}

/**
 * Converts process-like environment variables into the validated runtime
 * settings shared by the HTTP server and background matching service.
 */
export function readRuntimeConfig(environment = {}) {
  const marketMode = normalizeMarketMode(environment.MARKET_MODE);
  return {
    marketMode,
    demoBanner: marketMode === "demo",
    databasePath: optionalString(environment.RENTAL_DATABASE_PATH),
    uploadDirectory: optionalString(environment.RENTAL_UPLOAD_DIRECTORY),
    aiEnabled: Boolean(
      optionalString(environment.SILICONFLOW_API_KEY) ||
      optionalString(environment.SILICONFLOW_API_KEY_FILE)
    )
  };
}

