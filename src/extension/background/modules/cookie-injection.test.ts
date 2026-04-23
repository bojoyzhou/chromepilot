import { describe, expect, it, vi } from "vitest";
import { injectCookiesIfMissing } from "./proxy-utils";

describe("injectCookiesIfMissing", () => {
  it("injects cookies when no Cookie header is present", async () => {
    const headers: Record<string, string> = { Host: "example.com" };
    const fakeCookies = [
      { name: "sid", value: "abc123" },
      { name: "token", value: "xyz" },
    ];
    const getCookies = vi.fn().mockResolvedValue(fakeCookies);

    const result = await injectCookiesIfMissing(headers, "https://example.com/path", getCookies);

    expect(result).toBe(true);
    expect(headers["Cookie"]).toBe("sid=abc123; token=xyz");
    expect(getCookies).toHaveBeenCalledWith({ url: "https://example.com/path" });
  });

  it("skips injection when Cookie header already exists (capitalized)", async () => {
    const headers: Record<string, string> = { Cookie: "existing=value" };
    const getCookies = vi.fn().mockResolvedValue([{ name: "sid", value: "abc" }]);

    const result = await injectCookiesIfMissing(headers, "https://example.com", getCookies);

    expect(result).toBe(false);
    expect(headers["Cookie"]).toBe("existing=value");
    expect(getCookies).not.toHaveBeenCalled();
  });

  it("skips injection when cookie header already exists (lowercase)", async () => {
    const headers: Record<string, string> = { cookie: "existing=value" };
    const getCookies = vi.fn().mockResolvedValue([{ name: "sid", value: "abc" }]);

    const result = await injectCookiesIfMissing(headers, "https://example.com", getCookies);

    expect(result).toBe(false);
    expect(headers["cookie"]).toBe("existing=value");
    expect(getCookies).not.toHaveBeenCalled();
  });

  it("returns false when no cookies found for URL", async () => {
    const headers: Record<string, string> = { Host: "example.com" };
    const getCookies = vi.fn().mockResolvedValue([]);

    const result = await injectCookiesIfMissing(headers, "https://example.com", getCookies);

    expect(result).toBe(false);
    expect(headers["Cookie"]).toBeUndefined();
  });

  it("handles getCookies errors gracefully and returns false", async () => {
    const headers: Record<string, string> = { Host: "example.com" };
    const getCookies = vi.fn().mockRejectedValue(new Error("Permission denied"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await injectCookiesIfMissing(headers, "https://example.com", getCookies);

    expect(result).toBe(false);
    expect(headers["Cookie"]).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[proxy] cookie injection failed:",
      "Permission denied",
    );

    warnSpy.mockRestore();
  });

  it("injects single cookie correctly", async () => {
    const headers: Record<string, string> = {};
    const getCookies = vi.fn().mockResolvedValue([{ name: "session", value: "s3cr3t" }]);

    const result = await injectCookiesIfMissing(headers, "https://secure.example.com", getCookies);

    expect(result).toBe(true);
    expect(headers["Cookie"]).toBe("session=s3cr3t");
  });

  it("preserves existing headers when injecting cookies", async () => {
    const headers: Record<string, string> = {
      Host: "example.com",
      "X-Custom": "value",
      Accept: "application/json",
    };
    const getCookies = vi.fn().mockResolvedValue([{ name: "a", value: "1" }]);

    await injectCookiesIfMissing(headers, "https://example.com", getCookies);

    expect(headers["Host"]).toBe("example.com");
    expect(headers["X-Custom"]).toBe("value");
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["Cookie"]).toBe("a=1");
  });
});
