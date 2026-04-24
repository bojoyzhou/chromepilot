// Proxy rule matching — pure logic, no Chrome API dependencies
// Extracted from legacy.ts Fetch.requestPaused handler for testability

export interface ProxyRule {
  pattern: string;
  action?: string;
  setHeaders?: Record<string, string>;
  target?: string;
  setHost?: string;
  delay?: number;
  response?: {
    status?: number;
    headers?: Record<string, string>;
    body?: unknown;
  };
  [key: string]: unknown;
}

export interface MatchResult {
  disableMatched: boolean;
  headerMods: Record<string, string>;
  actionRule: ProxyRule | null;
}

/**
 * Test if a URL matches a rule pattern (regex first, then substring fallback).
 */
export function testPattern(pattern: string, url: string): boolean {
  try {
    return new RegExp(pattern).test(url);
  } catch {
    return url.includes(pattern);
  }
}

/**
 * Match proxy rules against a URL in request stage.
 *
 * Evaluation order:
 * 1. Check `disable` rules — if matched, short-circuit (disableMatched=true)
 * 2. Collect all matching `header` rules into headerMods
 * 3. Find first matching non-header/non-resHeader rule as actionRule
 */
export function matchRules(url: string, rules: ProxyRule[]): MatchResult {
  // Pass 0: check disable rules
  for (const r of rules) {
    if (r.action !== "disable") continue;
    if (testPattern(r.pattern, url)) {
      return { disableMatched: true, headerMods: {}, actionRule: null };
    }
  }

  // Pass 1+2: collect headers and find action
  const headerMods: Record<string, string> = {};
  let actionRule: ProxyRule | null = null;

  for (const r of rules) {
    if (!testPattern(r.pattern, url)) continue;

    if ((r.action || "mock") === "header") {
      Object.assign(headerMods, r.setHeaders || {});
    } else if (r.action === "resHeader") {
      // Skip — handled at response stage
    } else if (r.action === "disable") {
      // Already handled above
    } else if (!actionRule) {
      actionRule = r;
    }
  }

  return { disableMatched: false, headerMods, actionRule };
}

/**
 * Collect resHeader modifications for response stage.
 * Returns null if disable rule matches first.
 */
export function matchResHeaderRules(
  url: string,
  rules: ProxyRule[],
): Record<string, string> | null {
  // Check disable first
  for (const r of rules) {
    if (r.action !== "disable") continue;
    if (testPattern(r.pattern, url)) return null;
  }

  const mods: Record<string, string> = {};
  for (const r of rules) {
    if (r.action !== "resHeader") continue;
    if (!testPattern(r.pattern, url)) continue;
    Object.assign(mods, r.setHeaders || {});
  }
  return mods;
}

/**
 * Build CDP-compatible headers array by merging headerMods into original headers.
 */
export function buildHeaders(
  original: Record<string, string>,
  headerMods: Record<string, string>,
): Array<{ name: string; value: string }> {
  const headers = Object.entries(original || {}).map(([n, v]) => ({
    name: n,
    value: v,
  }));
  for (const [k, v] of Object.entries(headerMods)) {
    const idx = headers.findIndex((h) => h.name.toLowerCase() === k.toLowerCase());
    if (idx >= 0) headers[idx].value = v;
    else headers.push({ name: k, value: v });
  }
  return headers;
}
