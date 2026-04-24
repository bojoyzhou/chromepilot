import { describe, expect, it } from "vitest";
import { resolveOrigin, applySmartCors, mergeResponseHeaders } from "./cors-helper";

describe("cors-helper", () => {
  // ── resolveOrigin ──
  describe("resolveOrigin", () => {
    it("extracts from Origin header", () => {
      expect(resolveOrigin({ Origin: "https://app.example.com" })).toBe("https://app.example.com");
    });

    it("case-insensitive Origin lookup", () => {
      expect(resolveOrigin({ origin: "https://app.example.com" })).toBe("https://app.example.com");
    });

    it("falls back to Referer", () => {
      expect(resolveOrigin({ Referer: "https://app.example.com/page?q=1" })).toBe(
        "https://app.example.com",
      );
    });

    it("returns empty for no origin or referer", () => {
      expect(resolveOrigin({ Host: "example.com" })).toBe("");
    });

    it("returns empty for invalid referer URL", () => {
      expect(resolveOrigin({ Referer: "not-a-url" })).toBe("");
    });

    it("prefers Origin over Referer", () => {
      expect(
        resolveOrigin({
          Origin: "https://origin.com",
          Referer: "https://referer.com/page",
        }),
      ).toBe("https://origin.com");
    });
  });

  // ── applySmartCors ──
  describe("applySmartCors", () => {
    it("replaces * with actual origin", () => {
      const mods = { "Access-Control-Allow-Origin": "*" };
      const changed = applySmartCors(mods, { Origin: "https://app.com" });
      expect(changed).toBe(true);
      expect(mods["Access-Control-Allow-Origin"]).toBe("https://app.com");
    });

    it("auto-adds credentials header", () => {
      const mods: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
      };
      applySmartCors(mods, { Origin: "https://app.com" });
      expect(mods["Access-Control-Allow-Credentials"]).toBe("true");
    });

    it("does not duplicate credentials if already present", () => {
      const mods: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
      };
      applySmartCors(mods, { Origin: "https://app.com" });
      // Should still be just one entry
      const credKeys = Object.keys(mods).filter(
        (k) => k.toLowerCase() === "access-control-allow-credentials",
      );
      expect(credKeys).toHaveLength(1);
    });

    it("no-op when ACAO is not *", () => {
      const mods = { "Access-Control-Allow-Origin": "https://specific.com" };
      const changed = applySmartCors(mods, { Origin: "https://app.com" });
      expect(changed).toBe(false);
      expect(mods["Access-Control-Allow-Origin"]).toBe("https://specific.com");
    });

    it("no-op when no ACAO header", () => {
      const mods = { "X-Custom": "value" };
      expect(applySmartCors(mods, { Origin: "https://app.com" })).toBe(false);
    });

    it("no-op when origin is null", () => {
      const mods = { "Access-Control-Allow-Origin": "*" };
      expect(applySmartCors(mods, { Origin: "null" })).toBe(false);
      expect(mods["Access-Control-Allow-Origin"]).toBe("*");
    });

    it("no-op when no origin found", () => {
      const mods = { "Access-Control-Allow-Origin": "*" };
      expect(applySmartCors(mods, { Host: "example.com" })).toBe(false);
    });

    it("uses Referer as fallback", () => {
      const mods: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
      };
      applySmartCors(mods, { Referer: "https://app.com/page" });
      expect(mods["Access-Control-Allow-Origin"]).toBe("https://app.com");
    });
  });

  // ── mergeResponseHeaders ──
  describe("mergeResponseHeaders", () => {
    it("adds new headers", () => {
      const result = mergeResponseHeaders([{ name: "Content-Type", value: "text/html" }], {
        "X-Frame-Options": "DENY",
      });
      expect(result).toEqual([
        { name: "Content-Type", value: "text/html" },
        { name: "X-Frame-Options", value: "DENY" },
      ]);
    });

    it("overwrites existing case-insensitively", () => {
      const result = mergeResponseHeaders([{ name: "Content-Type", value: "text/html" }], {
        "content-type": "application/json",
      });
      expect(result).toEqual([{ name: "Content-Type", value: "application/json" }]);
    });

    it("returns new array (original array length unchanged)", () => {
      const original = [{ name: "X", value: "1" }];
      const result = mergeResponseHeaders(original, { Y: "2" });
      expect(original).toHaveLength(1);
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({ name: "Y", value: "2" });
    });
  });
});
