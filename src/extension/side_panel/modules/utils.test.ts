// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { esc, truncate, ruleMatchesUrl, timeAgo } from "./utils";

// ─────────────────────────────────────────────────────────────
// esc — HTML escaping
// ─────────────────────────────────────────────────────────────
describe("esc", () => {
  it("escapes angle brackets", () => {
    expect(esc("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes ampersand and quotes", () => {
    expect(esc('a & "b"')).toBe('a &amp; "b"');
  });

  it("handles null/undefined gracefully", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });

  it("converts numbers to string", () => {
    expect(esc(42)).toBe("42");
  });

  it("returns empty string for empty input", () => {
    expect(esc("")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────
// truncate
// ─────────────────────────────────────────────────────────────
describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates long strings with ellipsis", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcde...");
  });

  it("handles exact length boundary", () => {
    expect(truncate("abc", 3)).toBe("abc");
  });

  it("uses default n=120", () => {
    const long = "a".repeat(200);
    const result = truncate(long);
    expect(result).toBe("a".repeat(120) + "...");
  });
});

// ─────────────────────────────────────────────────────────────
// ruleMatchesUrl
// ─────────────────────────────────────────────────────────────
describe("ruleMatchesUrl", () => {
  it("matches regex pattern", () => {
    expect(ruleMatchesUrl({ pattern: "^https?://example\\.com" }, "https://example.com/path")).toBe(
      true,
    );
  });

  it("returns false for non-matching regex", () => {
    expect(ruleMatchesUrl({ pattern: "^https?://other\\.com" }, "https://example.com")).toBe(false);
  });

  it("falls back to includes for invalid regex", () => {
    expect(ruleMatchesUrl({ pattern: "[invalid" }, "https://[invalid/test")).toBe(true);
  });

  it("returns false when url is empty", () => {
    expect(ruleMatchesUrl({ pattern: "test" }, "")).toBe(false);
  });

  it("returns false when pattern is undefined", () => {
    expect(ruleMatchesUrl({}, "https://example.com")).toBe(false);
  });

  it("returns false when url is undefined", () => {
    expect(ruleMatchesUrl({ pattern: "test" })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// timeAgo
// ─────────────────────────────────────────────────────────────
describe("timeAgo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty string for falsy input", () => {
    expect(timeAgo(undefined)).toBe("");
    expect(timeAgo(0)).toBe("");
  });

  it('returns "刚刚" for very recent timestamps', () => {
    expect(timeAgo(Date.now() - 2000)).toBe("刚刚");
  });

  it("returns seconds for < 60s", () => {
    const result = timeAgo(Date.now() - 30000);
    expect(result).toMatch(/^\d+s 前$/);
  });

  it("returns minutes for < 1h", () => {
    const result = timeAgo(Date.now() - 5 * 60 * 1000);
    expect(result).toMatch(/^\d+m 前$/);
  });

  it("returns hours for >= 1h", () => {
    const result = timeAgo(Date.now() - 2 * 3600 * 1000);
    expect(result).toMatch(/^\d+h 前$/);
  });
});
