export function esc(s: unknown): string {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
}

export function truncate(s: string, n = 120): string {
  return s.length > n ? s.slice(0, n) + "..." : s;
}

export function ruleMatchesUrl(rule: { pattern?: string }, url?: string): boolean {
  if (!url || !rule.pattern) return false;
  try {
    return new RegExp(rule.pattern).test(url);
  } catch {
    return url.includes(rule.pattern);
  }
}

export function timeAgo(ts?: number): string {
  if (!ts) return "";
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 5) return "刚刚";
  if (diff < 60) return `${diff}s 前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m 前`;
  return `${Math.floor(diff / 3600)}h 前`;
}
