// Smart CORS helper — pure logic, no Chrome API dependencies
// Extracted from legacy.ts response-stage resHeader handling

/**
 * Extract origin from request headers (Origin first, Referer fallback).
 */
export function resolveOrigin(requestHeaders: Record<string, string>): string {
  // Try Origin header (case-insensitive)
  for (const [k, v] of Object.entries(requestHeaders)) {
    if (k.toLowerCase() === "origin") return v;
  }
  // Fallback: derive from Referer
  for (const [k, v] of Object.entries(requestHeaders)) {
    if (k.toLowerCase() === "referer") {
      try {
        return new URL(v).origin;
      } catch {
        return "";
      }
    }
  }
  return "";
}

/**
 * Apply Smart CORS transformation to resHeader modifications.
 *
 * When Access-Control-Allow-Origin is set to "*", replace with actual
 * request origin (browsers reject wildcard when credentials are included).
 * Also auto-adds Access-Control-Allow-Credentials if missing.
 *
 * Mutates `resHeaderMods` in place and returns whether changes were made.
 */
export function applySmartCors(
  resHeaderMods: Record<string, string>,
  requestHeaders: Record<string, string>,
): boolean {
  const acaoKey = Object.keys(resHeaderMods).find(
    (k) => k.toLowerCase() === "access-control-allow-origin",
  );
  if (!acaoKey || resHeaderMods[acaoKey] !== "*") return false;

  const origin = resolveOrigin(requestHeaders);
  if (!origin || origin === "null") return false;

  resHeaderMods[acaoKey] = origin;

  // Auto-add Access-Control-Allow-Credentials if not already present
  const hasCredentials = Object.keys(resHeaderMods).find(
    (k) => k.toLowerCase() === "access-control-allow-credentials",
  );
  if (!hasCredentials) {
    resHeaderMods["Access-Control-Allow-Credentials"] = "true";
  }

  return true;
}

/**
 * Merge resHeader modifications into CDP response headers array.
 */
export function mergeResponseHeaders(
  original: Array<{ name: string; value: string }>,
  mods: Record<string, string>,
): Array<{ name: string; value: string }> {
  const headers = [...original];
  for (const [k, v] of Object.entries(mods)) {
    const idx = headers.findIndex((h) => h.name.toLowerCase() === k.toLowerCase());
    if (idx >= 0) headers[idx].value = v;
    else headers.push({ name: k, value: v });
  }
  return headers;
}
