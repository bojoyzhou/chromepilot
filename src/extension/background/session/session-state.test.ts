import { describe, expect, it, beforeEach } from "vitest";
import {
  assignColor,
  releaseColor,
  findSessionByTab,
  sessionOwnsTab,
  addActionLog,
  computeBadgeState,
  computeTabGroupProps,
  sessions,
  usedColors,
  COLOR_POOL,
  _resetForTest,
  type SessionData,
} from "./session-state";

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    sessionId: "s-test",
    name: "test",
    tabIds: [1],
    groupId: 100,
    color: "blue",
    createdAt: Date.now(),
    lastHeartbeat: Date.now(),
    lastCommandAt: Date.now(),
    status: "active",
    actionLog: [],
    ...overrides,
  };
}

describe("session-state", () => {
  beforeEach(() => _resetForTest());

  // ── Color Pool ──
  describe("assignColor / releaseColor", () => {
    it("assigns colors in pool order", () => {
      const c1 = assignColor();
      const c2 = assignColor();
      expect(c1).toBe("blue");
      expect(c2).toBe("red");
    });

    it("returns grey when pool exhausted", () => {
      for (let i = 0; i < COLOR_POOL.length; i++) assignColor();
      expect(assignColor()).toBe("grey");
    });

    it("released color can be reassigned", () => {
      const c1 = assignColor(); // blue
      assignColor(); // red
      releaseColor(c1);
      expect(assignColor()).toBe("blue");
    });

    it("releasing non-existent color is safe", () => {
      releaseColor("nonexistent");
      expect(usedColors.size).toBe(0);
    });
  });

  // ── Session Lookup ──
  describe("findSessionByTab / sessionOwnsTab", () => {
    it("finds session by tab id", () => {
      const s = makeSession({ sessionId: "s-1", tabIds: [10, 20] });
      sessions.set("s-1", s);
      expect(findSessionByTab(10)).toBe(s);
      expect(findSessionByTab(20)).toBe(s);
    });

    it("returns null for unknown tab", () => {
      sessions.set("s-1", makeSession({ tabIds: [10] }));
      expect(findSessionByTab(99)).toBeNull();
    });

    it("sessionOwnsTab returns boolean", () => {
      sessions.set("s-1", makeSession({ tabIds: [10] }));
      expect(sessionOwnsTab(10)).toBe(true);
      expect(sessionOwnsTab(99)).toBe(false);
    });

    it("handles multiple sessions", () => {
      sessions.set("s-1", makeSession({ sessionId: "s-1", tabIds: [10] }));
      sessions.set("s-2", makeSession({ sessionId: "s-2", tabIds: [20] }));
      expect(findSessionByTab(10)?.sessionId).toBe("s-1");
      expect(findSessionByTab(20)?.sessionId).toBe("s-2");
    });
  });

  // ── Action Log ──
  describe("addActionLog", () => {
    it("appends log entry", () => {
      const s = makeSession();
      addActionLog(s, "start", "Session started");
      expect(s.actionLog).toHaveLength(1);
      expect(s.actionLog[0].action).toBe("start");
      expect(s.actionLog[0].summary).toBe("Session started");
      expect(s.actionLog[0].ts).toBeGreaterThan(0);
    });

    it("truncates at 100 entries", () => {
      const s = makeSession();
      for (let i = 0; i < 105; i++) {
        addActionLog(s, "action", `entry ${i}`);
      }
      expect(s.actionLog).toHaveLength(100);
      // First entry should be #5 (0-4 were shifted out)
      expect(s.actionLog[0].summary).toBe("entry 5");
      expect(s.actionLog[99].summary).toBe("entry 104");
    });
  });

  // ── Badge State ──
  describe("computeBadgeState", () => {
    it("returns empty text when no sessions", () => {
      expect(computeBadgeState()).toEqual({ text: "", color: null });
    });

    it("returns count for active sessions", () => {
      sessions.set("s-1", makeSession({ status: "active" }));
      sessions.set("s-2", makeSession({ sessionId: "s-2", status: "active" }));
      expect(computeBadgeState()).toEqual({ text: "2", color: "#4CAF50" });
    });

    it("returns orange when degraded session exists", () => {
      sessions.set("s-1", makeSession({ status: "active" }));
      sessions.set("s-2", makeSession({ sessionId: "s-2", status: "degraded" }));
      const badge = computeBadgeState();
      expect(badge.text).toBe("1"); // only active counts
      expect(badge.color).toBe("#FFA500");
    });

    it("returns orange for orphaned", () => {
      sessions.set("s-1", makeSession({ status: "active" }));
      sessions.set("s-2", makeSession({ sessionId: "s-2", status: "orphaned" }));
      expect(computeBadgeState().color).toBe("#FFA500");
    });

    it("returns empty when only paused sessions", () => {
      sessions.set("s-1", makeSession({ status: "paused" }));
      expect(computeBadgeState()).toEqual({ text: "", color: null });
    });
  });

  // ── Tab Group Props ──
  describe("computeTabGroupProps", () => {
    it("active session", () => {
      const s = makeSession({ name: "MyAgent", status: "active", color: "blue" });
      expect(computeTabGroupProps(s)).toEqual({
        title: "[Agent] MyAgent",
        color: "blue",
      });
    });

    it("paused session", () => {
      const s = makeSession({ name: "X", status: "paused", color: "red" });
      expect(computeTabGroupProps(s)).toEqual({
        title: "[暂停] X",
        color: "red",
      });
    });

    it("degraded session", () => {
      const s = makeSession({ name: "Y", status: "degraded", color: "green" });
      expect(computeTabGroupProps(s)).toEqual({
        title: "[受限] Y",
        color: "green",
      });
    });

    it("orphaned session uses grey", () => {
      const s = makeSession({ name: "Z", status: "orphaned", color: "purple" });
      expect(computeTabGroupProps(s)).toEqual({
        title: "[已断开] Z",
        color: "grey",
      });
    });
  });
});
