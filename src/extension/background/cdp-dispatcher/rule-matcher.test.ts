import { describe, expect, it } from "vitest";
import {
  testPattern,
  matchRules,
  matchResHeaderRules,
  buildHeaders,
  type ProxyRule,
} from "./rule-matcher";

describe("rule-matcher", () => {
  // ── testPattern ──
  describe("testPattern", () => {
    it("matches regex pattern", () => {
      expect(testPattern("example\\.com/api", "https://example.com/api/v1")).toBe(true);
    });

    it("rejects non-matching regex", () => {
      expect(testPattern("^https://foo", "https://bar.com")).toBe(false);
    });

    it("falls back to substring on invalid regex", () => {
      expect(testPattern("[invalid(", "has [invalid( in it")).toBe(true);
      expect(testPattern("[invalid(", "no match here")).toBe(false);
    });
  });

  // ── matchRules (request stage) ──
  describe("matchRules", () => {
    it("disable rule short-circuits", () => {
      const rules: ProxyRule[] = [
        { pattern: "api/health", action: "disable" },
        { pattern: "api", action: "mock", response: { body: "{}" } },
      ];
      const result = matchRules("https://example.com/api/health", rules);
      expect(result.disableMatched).toBe(true);
      expect(result.actionRule).toBeNull();
    });

    it("collects header mods from multiple rules", () => {
      const rules: ProxyRule[] = [
        { pattern: "example", action: "header", setHeaders: { "X-Env": "pre" } },
        { pattern: "example", action: "header", setHeaders: { "X-User": "test" } },
      ];
      const result = matchRules("https://example.com/api", rules);
      expect(result.disableMatched).toBe(false);
      expect(result.headerMods).toEqual({ "X-Env": "pre", "X-User": "test" });
      expect(result.actionRule).toBeNull();
    });

    it("picks first matching action rule", () => {
      const rules: ProxyRule[] = [
        { pattern: "api", action: "block" },
        { pattern: "api", action: "redirect", target: "https://other.com" },
      ];
      const result = matchRules("https://example.com/api", rules);
      expect(result.actionRule?.action).toBe("block");
    });

    it("skips resHeader rules in request stage", () => {
      const rules: ProxyRule[] = [
        { pattern: "api", action: "resHeader", setHeaders: { "X-Frame": "DENY" } },
        { pattern: "api", action: "mock", response: { body: "ok" } },
      ];
      const result = matchRules("https://example.com/api", rules);
      expect(result.headerMods).toEqual({});
      expect(result.actionRule?.action).toBe("mock");
    });

    it("combines header mods with action rule", () => {
      const rules: ProxyRule[] = [
        { pattern: "api", action: "header", setHeaders: { "X-Env": "pre" } },
        { pattern: "api", action: "redirect", target: "https://new.com" },
      ];
      const result = matchRules("https://example.com/api", rules);
      expect(result.headerMods).toEqual({ "X-Env": "pre" });
      expect(result.actionRule?.action).toBe("redirect");
    });

    it("non-matching rules are ignored", () => {
      const rules: ProxyRule[] = [{ pattern: "other\\.com", action: "block" }];
      const result = matchRules("https://example.com/api", rules);
      expect(result.disableMatched).toBe(false);
      expect(result.actionRule).toBeNull();
    });

    it("default action is mock when unspecified", () => {
      const rules: ProxyRule[] = [{ pattern: "api", response: { body: "mocked" } }];
      const result = matchRules("https://example.com/api", rules);
      // action is undefined → (r.action || "mock") === "mock" → not "header"
      // so it becomes actionRule
      expect(result.actionRule).toBe(rules[0]);
    });
  });

  // ── matchResHeaderRules (response stage) ──
  describe("matchResHeaderRules", () => {
    it("collects resHeader modifications", () => {
      const rules: ProxyRule[] = [
        { pattern: "api", action: "resHeader", setHeaders: { "X-Frame-Options": "DENY" } },
        { pattern: "api", action: "resHeader", setHeaders: { "X-XSS": "1" } },
      ];
      const result = matchResHeaderRules("https://example.com/api", rules);
      expect(result).toEqual({ "X-Frame-Options": "DENY", "X-XSS": "1" });
    });

    it("returns null when disable matches", () => {
      const rules: ProxyRule[] = [
        { pattern: "api", action: "disable" },
        { pattern: "api", action: "resHeader", setHeaders: { "X-Frame": "DENY" } },
      ];
      expect(matchResHeaderRules("https://example.com/api", rules)).toBeNull();
    });

    it("returns empty object for no matches", () => {
      const rules: ProxyRule[] = [
        { pattern: "other", action: "resHeader", setHeaders: { "X-Frame": "DENY" } },
      ];
      expect(matchResHeaderRules("https://example.com/api", rules)).toEqual({});
    });

    it("ignores non-resHeader rules", () => {
      const rules: ProxyRule[] = [
        { pattern: "api", action: "mock" },
        { pattern: "api", action: "header", setHeaders: { "X-Env": "pre" } },
      ];
      expect(matchResHeaderRules("https://example.com/api", rules)).toEqual({});
    });
  });

  // ── buildHeaders ──
  describe("buildHeaders", () => {
    it("merges new headers", () => {
      const result = buildHeaders(
        { Host: "example.com", Accept: "text/html" },
        { "X-Custom": "value" },
      );
      expect(result).toEqual([
        { name: "Host", value: "example.com" },
        { name: "Accept", value: "text/html" },
        { name: "X-Custom", value: "value" },
      ]);
    });

    it("overwrites existing headers case-insensitively", () => {
      const result = buildHeaders(
        { "Content-Type": "text/plain" },
        { "content-type": "application/json" },
      );
      expect(result).toEqual([{ name: "Content-Type", value: "application/json" }]);
    });

    it("handles empty original", () => {
      const result = buildHeaders({}, { "X-New": "val" });
      expect(result).toEqual([{ name: "X-New", value: "val" }]);
    });

    it("handles empty mods", () => {
      const result = buildHeaders({ Host: "a.com" }, {});
      expect(result).toEqual([{ name: "Host", value: "a.com" }]);
    });
  });
});
