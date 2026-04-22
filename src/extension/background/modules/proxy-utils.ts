export interface ProxyRuleLike {
  action?: string;
}

export function getFetchPatterns(rules?: ProxyRuleLike[]): Array<{
  urlPattern: string;
  requestStage: "Request" | "Response";
}> {
  const patterns: Array<{ urlPattern: string; requestStage: "Request" | "Response" }> = [
    { urlPattern: "*", requestStage: "Request" },
  ];
  if (rules && rules.some((r) => r.action === "resHeader")) {
    patterns.push({ urlPattern: "*", requestStage: "Response" });
  }
  return patterns;
}
