// Network CDP event handlers (Network.*)
// Extracted from legacy.ts debugger.onEvent listener

import { networkBuffers } from "../shared-state";
import { pushEvent } from "../ws-bridge";

export function handleNetworkEvent(tabId: number, method: string, params: any): boolean {
  if (method === "Network.requestWillBeSent") {
    const buf = networkBuffers.get(tabId);
    if (!buf) return true; // consumed but no buffer
    const entry: Record<string, unknown> = {
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      headers: params.request.headers,
      postData: params.request.postData || null,
      type: params.type,
      initiator: params.initiator?.type,
      ts: params.wallTime ? Math.round(params.wallTime * 1000) : Date.now(),
    };
    buf.push(entry);
    pushEvent("net.request", tabId, { url: entry.url, method: entry.method, type: entry.type });
    return true;
  }

  if (method === "Network.responseReceived") {
    const buf = networkBuffers.get(tabId);
    if (!buf) return true;
    const entry = buf.find((r: any) => r.requestId === params.requestId);
    if (entry) {
      entry.statusCode = params.response.status;
      entry.statusText = params.response.statusText;
      entry.responseHeaders = params.response.headers;
      entry.mimeType = params.response.mimeType;
      entry.remoteAddr = params.response.remoteIPAddress;
      entry.protocol = params.response.protocol;
      pushEvent("net.response", tabId, {
        url: entry.url,
        status: entry.statusCode,
        mimeType: entry.mimeType,
      });
    }
    return true;
  }

  if (method === "Network.loadingFinished") {
    const buf = networkBuffers.get(tabId);
    if (!buf) return true;
    const entry = buf.find((r: any) => r.requestId === params.requestId);
    if (entry) {
      entry.size = params.encodedDataLength;
      entry.done = true;
    }
    return true;
  }

  if (method === "Network.loadingFailed") {
    const buf = networkBuffers.get(tabId);
    if (!buf) return true;
    const entry = buf.find((r: any) => r.requestId === params.requestId);
    if (entry) {
      entry.error = params.errorText;
      entry.canceled = params.canceled;
      entry.done = true;
    }
    return true;
  }

  return false; // not handled
}
