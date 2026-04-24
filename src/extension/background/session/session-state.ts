// Session state management — pure logic, no Chrome API dependencies
// Extracted from legacy.ts for testability

export interface SessionData {
  sessionId: string;
  name: string;
  tabIds: number[];
  groupId: number | null;
  color: string;
  createdAt: number;
  lastHeartbeat: number;
  lastCommandAt: number;
  status: "active" | "paused" | "degraded" | "orphaned" | "closed";
  actionLog: ActionLogEntry[];
}

export interface ActionLogEntry {
  action: string;
  summary: string;
  ts: number;
}

export const COLOR_POOL = [
  "blue",
  "red",
  "green",
  "purple",
  "cyan",
  "orange",
  "pink",
  "yellow",
] as const;

export const sessions = new Map<string, SessionData>();
export const usedColors = new Set<string>();

const MAX_ACTION_LOG = 100;

export function assignColor(): string {
  for (const c of COLOR_POOL) {
    if (!usedColors.has(c)) {
      usedColors.add(c);
      return c;
    }
  }
  return "grey";
}

export function releaseColor(color: string): void {
  usedColors.delete(color);
}

export function findSessionByTab(tabId: number): SessionData | null {
  for (const s of sessions.values()) {
    if (s.tabIds.includes(tabId)) return s;
  }
  return null;
}

export function sessionOwnsTab(tabId: number): boolean {
  return !!findSessionByTab(tabId);
}

export function addActionLog(session: SessionData, action: string, summary: string): void {
  session.actionLog.push({ action, summary, ts: Date.now() });
  if (session.actionLog.length > MAX_ACTION_LOG) session.actionLog.shift();
}

/**
 * Compute badge text and color from current sessions.
 * Returns pure data — caller is responsible for calling chrome.action APIs.
 */
export function computeBadgeState(): {
  text: string;
  color: string | null;
} {
  const activeCount = [...sessions.values()].filter((s) => s.status === "active").length;
  if (activeCount === 0) return { text: "", color: null };

  const hasDegraded = [...sessions.values()].some(
    (s) => s.status === "degraded" || s.status === "orphaned",
  );
  return {
    text: String(activeCount),
    color: hasDegraded ? "#FFA500" : "#4CAF50",
  };
}

/**
 * Compute tab group title and color for a session.
 * Returns pure data — caller is responsible for calling chrome.tabGroups APIs.
 */
export function computeTabGroupProps(session: SessionData): {
  title: string;
  color: string;
} {
  const titleMap: Record<string, string> = {
    active: `[Agent] ${session.name}`,
    paused: `[暂停] ${session.name}`,
    degraded: `[受限] ${session.name}`,
    orphaned: `[已断开] ${session.name}`,
  };
  const title = titleMap[session.status] || `[Agent] ${session.name}`;
  const color = session.status === "orphaned" ? "grey" : session.color;
  return { title, color };
}

/** Reset all session state — for testing only */
export function _resetForTest(): void {
  sessions.clear();
  usedColors.clear();
}
