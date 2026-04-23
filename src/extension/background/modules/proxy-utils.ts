export interface ProxyRuleLike {
  action?: string;
}

export function getFetchPatterns(rules?: ProxyRuleLike[]): Array<{
  urlPattern: string;
  requestStage: "Request" | "Response";
}> {
  const patterns: Array<{ urlPattern: string; requestStage: "Request" | "Response" }> = [
    { urlPattern: "*", requestStage: "Request" },
  ];
  if (rules && rules.some((r) => r.action === "resHeader")) {
    patterns.push({ urlPattern: "*", requestStage: "Response" });
  }
  return patterns;
}

/**
 * Inject cookies from the browser cookie store into the request headers
 * if no Cookie header is already present.
 *
 * CDP Fetch.requestPaused provides headers BEFORE the browser's cookie store
 * injects the Cookie header. When using Fetch.fulfillRequest (bypassing the
 * network layer entirely), cookies are never sent — causing CSRF failures.
 *
 * @param headers - Mutable headers object to inject cookies into.
 * @param url - The original request URL for cookie lookup.
 * @param getCookies - Async function that retrieves cookies for a URL
 *   (defaults to chrome.cookies.getAll).
 * @returns true if cookies were injected, false otherwise.
 */
export async function injectCookiesIfMissing(
  headers: Record<string, string>,
  url: string,
  getCookies: (query: { url: string }) => Promise<Array<{ name: string; value: string }>> = (q) =>
    chrome.cookies.getAll(q),
): Promise<boolean> {
  if (headers["Cookie"] || headers["cookie"]) return false;
  try {
    const cookies = await getCookies({ url });
    if (cookies.length > 0) {
      headers["Cookie"] = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      return true;
    }
  } catch (e: unknown) {
    console.warn("[proxy] cookie injection failed:", (e as Error).message);
  }
  return false;
}
