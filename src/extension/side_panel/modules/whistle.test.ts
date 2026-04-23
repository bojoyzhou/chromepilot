import { describe, expect, it } from "vitest";
import {
  parseWhistleRules,
  ruleToWhistle,
  rulesToWhistle,
} from "./whistle";

// ─────────────────────────────────────────────────────────
// parseWhistleRules — all 11 rule types
// ─────────────────────────────────────────────────────────
describe("parseWhistleRules", () => {
  it("parses domain redirect", () => {
    const rules = parseWhistleRules("example.com https://target.com");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      action: "redirect",
      pattern: "^https?://example\\.com(.*)$",
      target: "https://target.com$1",
    });
  });

  it("parses host:// multi-domain mapping", () => {
    const rules = parseWhistleRules("host://api.internal foo.com bar.com");
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({
      action: "redirect",
      setHost: "foo.com",
      target: "$1://api.internal$2",
    });
    expect(rules[1]).toMatchObject({
      action: "redirect",
      setHost: "bar.com",
      target: "$1://api.internal$2",
    });
  });

  it("parses disable://", () => {
    const rules = parseWhistleRules("example.com disable://");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: "disable" });
  });

  it("parses block://", () => {
    const rules = parseWhistleRules("example.com block://");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: "block" });
  });

  it("parses mock:// with status and body", () => {
    const rules = parseWhistleRules('example.com mock://200 {"ok":true}');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      action: "mock",
      response: { status: 200, body: '{"ok":true}', headers: { "Content-Type": "application/json" } },
    });
  });

  it("parses mock:// with status only", () => {
    const rules = parseWhistleRules("example.com mock://404");
    expect(rules).toHaveLength(1);
    expect(rules[0].response.status).toBe(404);
    expect(rules[0].response.body).toBeUndefined();
  });

  it("parses delay://", () => {
    const rules = parseWhistleRules("example.com delay://2000");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ action: "delay", delay: 2000 });
  });

  it("parses reqHeaders:// with parentheses", () => {
    const rules = parseWhistleRules("example.com reqHeaders://(X-Env: test)");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      action: "header",
      setHeaders: { "X-Env": "test" },
    });
  });

  it("parses reqHeaders:// with multiple headers (\\n separated)", () => {
    const rules = parseWhistleRules("example.com reqHeaders://(X-A: 1\\nX-B: 2)");
    expect(rules).toHaveLength(1);
    expect(rules[0].setHeaders).toEqual({ "X-A": "1", "X-B": "2" });
  });

  it("parses resHeaders://", () => {
    const rules = parseWhistleRules(
      "example.com resHeaders://(Access-Control-Allow-Origin: *)",
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      action: "resHeader",
      setHeaders: { "Access-Control-Allow-Origin": "*" },
    });
  });

  it("parses IP host mapping (IP domain)", () => {
    const rules = parseWhistleRules("140.205.215.168 example.com");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      action: "redirect",
      target: "$1://140.205.215.168$2",
      setHost: "example.com",
    });
  });

  it("parses IP:port host mapping", () => {
    const rules = parseWhistleRules("127.0.0.1:6001 example.com");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      target: "$1://127.0.0.1:6001$2",
      setHost: "example.com",
    });
  });

  it("parses ^prefix regex rewrite with /***", () => {
    const rules = parseWhistleRules("^domain.com/*** http://target/$1");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      action: "redirect",
      pattern: "^https?://domain\\.com/(.*)$",
      target: "http://target/$1",
    });
  });

  it("parses URL redirect (scheme-specific)", () => {
    const rules = parseWhistleRules("https://source.com https://target.com");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      action: "redirect",
      target: "https://target.com$1",
    });
  });

  it("skips comments and blank lines", () => {
    const rules = parseWhistleRules("# comment\n\nexample.com block://\n  # another");
    expect(rules).toHaveLength(1);
    expect(rules[0].action).toBe("block");
  });

  it("skips lines with only one token", () => {
    const rules = parseWhistleRules("onlyonetoken");
    expect(rules).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────
// ruleToWhistle — serialization for each action type
// ─────────────────────────────────────────────────────────
describe("ruleToWhistle", () => {
  it("serializes disable rule", () => {
    expect(ruleToWhistle({ action: "disable", pattern: "^https?://example\\.com" })).toBe(
      "example.com disable://",
    );
  });

  it("serializes block rule", () => {
    expect(ruleToWhistle({ action: "block", pattern: "^https?://example\\.com" })).toBe(
      "example.com block://",
    );
  });

  it("serializes header rule", () => {
    const text = ruleToWhistle({
      action: "header",
      pattern: "^https?://example\\.com",
      setHeaders: { "X-Env": "test" },
    });
    expect(text).toBe("example.com reqHeaders://(X-Env: test)");
  });

  it("serializes resHeader rule", () => {
    const text = ruleToWhistle({
      action: "resHeader",
      pattern: "^https?://example\\.com",
      setHeaders: { "Access-Control-Allow-Origin": "*" },
    });
    expect(text).toBe("example.com resHeaders://(Access-Control-Allow-Origin: *)");
  });

  it("serializes mock rule", () => {
    const text = ruleToWhistle({
      action: "mock",
      pattern: "^https?://example\\.com",
      response: { status: 200, body: '{"ok":true}' },
    });
    expect(text).toBe('example.com mock://200 {"ok":true}');
  });

  it("serializes delay rule", () => {
    expect(
      ruleToWhistle({ action: "delay", pattern: "^https?://example\\.com", delay: 3000 }),
    ).toBe("example.com delay://3000");
  });

  it("serializes IP host mapping redirect", () => {
    const text = ruleToWhistle({
      action: "redirect",
      pattern: "^(https?)://example\\.com(.*)$",
      target: "$1://140.205.215.168$2",
      setHost: "example.com",
    });
    expect(text).toBe("140.205.215.168 example.com");
  });

  it("serializes host:// redirect", () => {
    const text = ruleToWhistle({
      action: "redirect",
      pattern: "^(https?)://foo\\.com(.*)$",
      target: "$1://api.internal$2",
      setHost: "foo.com",
    });
    expect(text).toBe("host://api.internal foo.com");
  });

  it("serializes unknown action as comment", () => {
    const text = ruleToWhistle({ action: "custom", pattern: "test" });
    expect(text).toMatch(/^# /);
  });
});

// ─────────────────────────────────────────────────────────
// rulesToWhistle — grouping and serialization
// ─────────────────────────────────────────────────────────
describe("rulesToWhistle", () => {
  it("serializes request header rule", () => {
    const text = rulesToWhistle([
      {
        action: "header",
        pattern: "^https?://example\\.com",
        setHeaders: { "X-Env": "test" },
      },
    ]);
    expect(text).toContain("reqHeaders://");
    expect(text).toContain("X-Env: test");
  });

  it("groups host:// rules by target", () => {
    const text = rulesToWhistle([
      { action: "redirect", pattern: "^(https?)://a\\.com(.*)$", target: "$1://t.host$2", setHost: "a.com" },
      { action: "redirect", pattern: "^(https?)://b\\.com(.*)$", target: "$1://t.host$2", setHost: "b.com" },
    ]);
    expect(text).toBe("host://t.host a.com b.com");
  });

  it("does not group IP host mapping into host:// lines", () => {
    const text = rulesToWhistle([
      { action: "redirect", pattern: "^(https?)://a\\.com(.*)$", target: "$1://1.2.3.4$2", setHost: "a.com" },
    ]);
    expect(text).toBe("1.2.3.4 a.com");
  });
});

// ─────────────────────────────────────────────────────────
// Round-trip: parseWhistleRules <-> rulesToWhistle
// ─────────────────────────────────────────────────────────
describe("parse <-> serialize round-trip", () => {
  const cases = [
    "example.com block://",
    "example.com disable://",
    "example.com delay://2000",
    "example.com mock://404",
    "140.205.215.168 example.com",
    "host://api.internal foo.com bar.com",
    "example.com https://target.com",
  ];

  it.each(cases)("round-trips: %s", (input) => {
    const rules = parseWhistleRules(input);
    const output = rulesToWhistle(rules);
    const rules2 = parseWhistleRules(output);
    // The re-parsed rules should produce the same JSON structure
    expect(rules2).toEqual(rules);
  });
});
