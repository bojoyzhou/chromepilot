// Page CDP event handlers (Page.*)
// Extracted from legacy.ts debugger.onEvent listener

import { findSessionByTab, addActionLog } from "../session/session-state";
import { pushEvent } from "../ws-bridge";

export function handlePageEvent(tabId: number, method: string, params: any): boolean {
  if (method === "Page.javascriptDialogOpening") {
    const session = findSessionByTab(tabId);
    if (session) {
      chrome.debugger.sendCommand({ tabId }, "Page.handleJavaScriptDialog", {
        accept: true,
        promptText: params.defaultPrompt || "",
      });
      addActionLog(
        session,
        "dialog_dismissed",
        `Auto-dismissed ${params.type}: ${(params.message || "").slice(0, 100)}`,
      );
      pushEvent("session.dialog", tabId, {
        sessionId: session.sessionId,
        type: params.type,
        message: params.message,
      });
    }
    return true;
  }

  return false;
}
