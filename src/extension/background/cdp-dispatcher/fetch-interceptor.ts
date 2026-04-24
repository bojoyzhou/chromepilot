// Fetch.requestPaused CDP event handler (proxy + legacy intercept)
// Extracted from legacy.ts debugger.onEvent listener

import { proxyState, interceptRules, MAX_PROXY_LOG } from "../shared-state";
import { pushEvent } from "../ws-bridge";
import { matchRules, buildHeaders } from "./rule-matcher";
import { applySmartCors, mergeResponseHeaders } from "./cors-helper";
import { injectCookiesIfMissing } from "../modules/proxy-utils";

export function handleFetchEvent(tabId: number, params: any): boolean {
  const url = params.request.url;

  // --- Proxy rules ---
  const pState = proxyState.get(tabId);
  if (pState) {
    // ── Response stage: apply resHeader modifiers ──
    if (params.responseStatusCode !== undefined) {
      handleResponseStage(tabId, url, params, pState);
      return true;
    }

    // ── Request stage ──
    handleRequestStage(tabId, url, params, pState);
    return true;
  }

  // --- Legacy intercept rules (backward compat) ---
  handleLegacyIntercept(tabId, url, params);
  return true;
}

function handleResponseStage(tabId: number, url: string, params: any, pState: any): void {
  // Check disable rules first
  for (const r of pState.rules) {
    if (r.action !== "disable") continue;
    let matches: boolean;
    try {
      matches = new RegExp(r.pattern).test(url);
    } catch {
      matches = url.includes(r.pattern);
    }
    if (matches) {
      chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
        requestId: params.requestId,
      });
      return;
    }
  }

  const resHeaderMods: Record<string, string> = {};
  for (const r of pState.rules) {
    if (r.action !== "resHeader") continue;
    let matches: boolean;
    try {
      matches = new RegExp(r.pattern).test(url);
    } catch {
      matches = url.includes(r.pattern);
    }
    if (!matches) continue;
    Object.assign(resHeaderMods, r.setHeaders || {});
  }

  if (Object.keys(resHeaderMods).length > 0) {
    // Smart CORS
    applySmartCors(resHeaderMods, params.request.headers || {});

    // Build modified response headers
    const headers = mergeResponseHeaders(params.responseHeaders || [], resHeaderMods);
    chrome.debugger.sendCommand({ tabId }, "Fetch.continueResponse", {
      requestId: params.requestId,
      responseCode: params.responseStatusCode,
      responseHeaders: headers,
    });
    const logEntry = {
      url,
      method: params.request.method,
      action: "resHeader",
      pattern: "resHeader",
      detail: `resHeaders: ${Object.keys(resHeaderMods).join(", ")}`,
      ts: Date.now(),
    };
    pState.log.push(logEntry);
    if (pState.log.length > MAX_PROXY_LOG) pState.log.splice(0, pState.log.length - MAX_PROXY_LOG);
    pushEvent("proxy.hit", tabId, logEntry);
  } else {
    chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
      requestId: params.requestId,
    });
  }
}

function handleRequestStage(tabId: number, url: string, params: any, pState: any): void {
  // Pass 0: check for 'disable' rules
  for (const r of pState.rules) {
    if (r.action !== "disable") continue;
    let matches: boolean;
    try {
      matches = new RegExp(r.pattern).test(url);
    } catch {
      matches = url.includes(r.pattern);
    }
    if (matches) {
      chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
        requestId: params.requestId,
      });
      return;
    }
  }

  // Pass 1+2: collect header mods + find action rule
  const result = matchRules(url, pState.rules);
  const headerMods = result.headerMods;
  const actionRule = result.actionRule;
  const hasHeaderMods = Object.keys(headerMods).length > 0;

  if (actionRule || hasHeaderMods) {
    const rule = actionRule || { action: "header", pattern: Object.keys(headerMods).join(",") };
    const action = rule.action || "mock";

    const logEntry: Record<string, any> = {
      url,
      method: params.request.method,
      pattern: rule.pattern,
      action,
      ts: Date.now(),
    };
    if (hasHeaderMods && action !== "header") {
      logEntry.headerMods = Object.keys(headerMods).join(", ");
    }

    if (action === "block") {
      chrome.debugger.sendCommand({ tabId }, "Fetch.failRequest", {
        requestId: params.requestId,
        reason: "Failed",
      });
      logEntry.detail = "blocked";
    } else if (action === "redirect") {
      handleRedirect(tabId, url, params, rule, headerMods, hasHeaderMods, logEntry);
    } else if (action === "delay") {
      const ms = rule.delay || 1000;
      setTimeout(() => {
        const cmd: Record<string, any> = { requestId: params.requestId };
        if (hasHeaderMods) cmd.headers = buildHeaders(params.request.headers, headerMods);
        chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", cmd);
      }, ms);
      logEntry.detail = `${ms}ms`;
    } else if (action === "header") {
      const headers = buildHeaders(params.request.headers, headerMods);
      chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
        requestId: params.requestId,
        headers,
      });
      logEntry.detail = `headers: ${Object.keys(headerMods).join(", ")}`;
    } else {
      // mock (default)
      handleMock(tabId, params, rule, logEntry);
    }

    pState.log.push(logEntry);
    if (pState.log.length > MAX_PROXY_LOG) pState.log.splice(0, pState.log.length - MAX_PROXY_LOG);
    pushEvent("proxy.hit", tabId, logEntry);
    return;
  }

  // No matching proxy rules, pass through to legacy intercept check
  handleLegacyIntercept(tabId, url, params);
}

function handleRedirect(
  tabId: number,
  url: string,
  params: any,
  rule: any,
  headerMods: Record<string, string>,
  hasHeaderMods: boolean,
  logEntry: Record<string, any>,
): void {
  let targetUrl = rule.target;
  try {
    const re = new RegExp(rule.pattern);
    targetUrl = url.replace(re, rule.target);
  } catch {
    /* ignore */
  }

  if (rule.setHost) {
    const ipMatch = targetUrl.match(/(\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?)/);
    let proxyTarget = ipMatch ? ipMatch[1] : null;
    if (!proxyTarget) {
      try {
        const u = new URL(targetUrl);
        if (u.hostname !== rule.setHost) proxyTarget = u.hostname;
      } catch {
        /* ignore */
      }
    }
    if (proxyTarget) {
      const mergedHeaders = { ...params.request.headers, ...headerMods };
      (async () => {
        try {
          await injectCookiesIfMissing(mergedHeaders, url);
          const resp = await fetch("http://127.0.0.1:8787/proxy/fetch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url,
              ip: proxyTarget,
              host: rule.setHost,
              method: params.request.method,
              headers: mergedHeaders,
              postData: params.request.postData || undefined,
            }),
          });
          const data = await resp.json();
          if (data.error) throw new Error(data.error);
          const rHeaders = Object.entries(data.headers || {}).map(([n, v]) => ({
            name: n,
            value: String(v),
          }));
          await chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
            requestId: params.requestId,
            responseCode: data.status || 200,
            responseHeaders: rHeaders,
            body: data.body || "",
          });
        } catch (e: any) {
          console.error(`[proxy] host mapping fetch failed for ${url}:`, e.message);
          chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
            requestId: params.requestId,
          });
        }
      })();
      logEntry.detail = `⇄ ${rule.setHost} → ${proxyTarget}`;
    } else {
      const cmd: Record<string, any> = { requestId: params.requestId, url: targetUrl };
      if (hasHeaderMods) cmd.headers = buildHeaders(params.request.headers, headerMods);
      chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", cmd);
      logEntry.detail = `→ ${targetUrl}`;
    }
  } else {
    const cmd: Record<string, any> = { requestId: params.requestId, url: targetUrl };
    if (hasHeaderMods) cmd.headers = buildHeaders(params.request.headers, headerMods);
    chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", cmd);
    logEntry.detail = `→ ${targetUrl}`;
  }
}

function handleMock(tabId: number, params: any, rule: any, logEntry: Record<string, any>): void {
  const resp = rule.response || rule;
  const rHeaders = Object.entries(resp.headers || {}).map(([n, v]: [string, any]) => ({
    name: n,
    value: String(v),
  }));
  if (!rHeaders.find((h) => h.name.toLowerCase() === "content-type")) {
    rHeaders.push({ name: "content-type", value: "application/json" });
  }
  const bodyStr = typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body || "");
  chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
    requestId: params.requestId,
    responseCode: resp.status || 200,
    responseHeaders: rHeaders,
    body: btoa(unescape(encodeURIComponent(bodyStr))),
  });
  logEntry.detail = `mock ${resp.status || 200}`;
}

function handleLegacyIntercept(tabId: number, url: string, params: any): void {
  const rules = interceptRules.get(tabId) || [];
  const matched = (rules as any[]).find((rule) => {
    try {
      return new RegExp(rule.urlPattern).test(url);
    } catch {
      return false;
    }
  });

  if (matched && matched.response) {
    const resp = matched.response;
    const headers = Object.entries(resp.headers || {}).map(([n, v]: [string, any]) => ({
      name: n,
      value: String(v),
    }));
    if (!headers.find((h) => h.name.toLowerCase() === "content-type")) {
      headers.push({ name: "content-type", value: "application/json" });
    }
    chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode: resp.status || 200,
      responseHeaders: headers,
      body: btoa(
        unescape(
          encodeURIComponent(typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body)),
        ),
      ),
    });
    pushEvent("net.intercepted", tabId, { url, action: "mock" });
  } else {
    chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
      requestId: params.requestId,
    });
  }
}
