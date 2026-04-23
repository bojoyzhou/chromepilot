import { describe, expect, it } from "vitest";
import { getFetchPatterns } from "./proxy-utils";

describe("getFetchPatterns", () => {
  it("returns request-only pattern for normal rules", () => {
    expect(getFetchPatterns([{ action: "redirect" }])).toEqual([
      { urlPattern: "*", requestStage: "Request" },
    ]);
  });

  it("adds response pattern for resHeader rules", () => {
    expect(getFetchPatterns([{ action: "resHeader" }])).toEqual([
      { urlPattern: "*", requestStage: "Request" },
      { urlPattern: "*", requestStage: "Response" },
    ]);
  });
});
