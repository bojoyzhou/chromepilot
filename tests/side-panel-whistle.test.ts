import { describe, expect, it } from "vitest";
import { parseWhistleRules, rulesToWhistle } from "../src/extension/side_panel/modules/whistle";

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

  it("parses host mapping group", () => {
    const rules = parseWhistleRules("host://api.internal foo.com bar.com");
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({
      action: "redirect",
      setHost: "foo.com",
      target: "$1://api.internal$2",
    });
  });
});

describe("rulesToWhistle", () => {
  it("serializes request header rule", () => {
    const text = rulesToWhistle([
      {
        action: "header",
        pattern: "^https?://example\\.com",
        setHeaders: {
          "X-Env": "test",
        },
      },
    ]);
    expect(text).toContain("reqHeaders://");
    expect(text).toContain("X-Env: test");
  });
});
