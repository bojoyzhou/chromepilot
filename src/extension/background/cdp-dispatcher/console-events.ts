// Console CDP event handlers (Runtime.*)
// Extracted from legacy.ts debugger.onEvent listener

import { consoleBuffers } from "../shared-state";
import { pushEvent } from "../ws-bridge";

export function handleConsoleEvent(tabId: number, method: string, params: any): boolean {
  if (method === "Runtime.consoleAPICalled") {
    const buf = consoleBuffers.get(tabId);
    if (!buf) return true;
    const entry = {
      level: params.type,
      args: params.args.map((a: any) =>
        a.value !== undefined ? a.value : a.description || `[${a.type}]`,
      ),
      ts: Math.round(params.timestamp),
      source: params.stackTrace?.callFrames?.[0]?.url,
    };
    buf.push(entry);
    pushEvent("console", tabId, entry);
    return true;
  }

  if (method === "Runtime.exceptionThrown") {
    const buf = consoleBuffers.get(tabId);
    if (!buf) return true;
    const ex = params.exceptionDetails;
    const entry = {
      level: "exception",
      text: ex?.text,
      description: ex?.exception?.description,
      ts: Math.round(params.timestamp),
      line: ex?.lineNumber,
      url: ex?.url,
    };
    buf.push(entry);
    pushEvent("console.exception", tabId, entry);
    return true;
  }

  return false;
}
