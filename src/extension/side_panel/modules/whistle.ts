function sourceToPattern(src: string): string {
  if (src.startsWith("^")) {
    const domain = src.slice(1);
    const escaped = domain
      .replace(/\./g, "\\.")
      .replace(/\*\*\*/g, "(.*)")
      .replace(/\*/g, "[^/]*");
    return "^https?://" + escaped;
  }
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return "^" + src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  const escaped = src.replace(/\./g, "\\.").replace(/\*/g, "[^.]*");
  return "^https?://" + escaped;
}

function patternToSource(pat: string): string {
  if (!pat) return "";
  const unescape = (s: string): string =>
    s
      .replace(/\\\./g, ".")
      .replace(/\[\^\/\]\*/g, "*")
      .replace(/\[\^\.\]\*/g, "*");
  const trimTrail = (s: string): string =>
    s
      .replace(/\/\(\.\*\)\$?$/, "/***")
      .replace(/\(\.\*\)\$?$/, "")
      .replace(/\$$/, "");
  let m: RegExpMatchArray | null;
  m = pat.match(/^\^https\?:\/\/(.+)$/);
  if (m) return unescape(trimTrail(m[1]));
  m = pat.match(/^\^\(https\?\):\/\/(.+)$/);
  if (m) return unescape(trimTrail(m[1]));
  m = pat.match(/^\^(https?):\/\/(.+)$/);
  if (m) return m[1] + "://" + unescape(trimTrail(m[2]));
  return unescape(trimTrail(pat));
}

export function parseWhistleRules(text: string): any[] {
  const rules: any[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const src = parts[0];
    const dst = parts[1];

    if (src.startsWith("host://")) {
      const targetHost = src.slice("host://".length);
      if (!targetHost) continue;
      for (let i = 1; i < parts.length; i++) {
        const domain = parts[i];
        if (!domain) continue;
        const escapedDomain = domain.replace(/\./g, "\\.");
        rules.push({
          pattern: "^(https?)://" + escapedDomain + "(.*)$",
          action: "redirect",
          target: "$1://" + targetHost + "$2",
          setHost: domain,
        });
      }
      continue;
    }

    if (dst === "disable://" || dst.startsWith("disable://")) {
      rules.push({ pattern: sourceToPattern(src), action: "disable" });
      continue;
    }
    if (dst === "block://" || dst.startsWith("block://")) {
      rules.push({ pattern: sourceToPattern(src), action: "block" });
      continue;
    }

    if (dst.startsWith("mock://")) {
      const content = parts.slice(1).join(" ").slice("mock://".length);
      const spaceIdx = content.indexOf(" ");
      let status: number;
      let body = "";
      if (spaceIdx > 0) {
        status = parseInt(content.slice(0, spaceIdx), 10) || 200;
        body = content.slice(spaceIdx + 1);
      } else {
        status = parseInt(content, 10) || 200;
      }
      const response: any = { status };
      if (body) {
        response.body = body;
        if (body.startsWith("{") || body.startsWith("[")) {
          response.headers = { "Content-Type": "application/json" };
        }
      }
      rules.push({ pattern: sourceToPattern(src), action: "mock", response });
      continue;
    }

    if (dst.startsWith("delay://")) {
      const ms = parseInt(dst.slice("delay://".length), 10) || 0;
      rules.push({ pattern: sourceToPattern(src), action: "delay", delay: ms });
      continue;
    }

    if (dst.startsWith("reqHeaders://")) {
      let headerContent = parts.slice(1).join(" ").slice("reqHeaders://".length);
      if (headerContent.startsWith("(") && headerContent.endsWith(")")) {
        headerContent = headerContent.slice(1, -1);
      }
      const setHeaders: Record<string, string> = {};
      for (const part of headerContent.split(/\\n|\n/)) {
        const colonIdx = part.indexOf(":");
        if (colonIdx > 0) {
          setHeaders[part.slice(0, colonIdx).trim()] = part.slice(colonIdx + 1).trim();
        }
      }
      if (Object.keys(setHeaders).length === 0) continue;
      rules.push({ pattern: sourceToPattern(src), action: "header", setHeaders });
      continue;
    }

    if (dst.startsWith("resHeaders://")) {
      let headerContent = parts.slice(1).join(" ").slice("resHeaders://".length);
      if (headerContent.startsWith("(") && headerContent.endsWith(")")) {
        headerContent = headerContent.slice(1, -1);
      }
      const setHeaders: Record<string, string> = {};
      for (const part of headerContent.split(/\\n|\n/)) {
        const colonIdx = part.indexOf(":");
        if (colonIdx > 0) {
          setHeaders[part.slice(0, colonIdx).trim()] = part.slice(colonIdx + 1).trim();
        }
      }
      if (Object.keys(setHeaders).length === 0) continue;
      rules.push({ pattern: sourceToPattern(src), action: "resHeader", setHeaders });
      continue;
    }

    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(src)) {
      const domain = dst;
      const ip = src;
      const escapedDomain = domain.replace(/\./g, "\\.");
      rules.push({
        pattern: "^(https?)://" + escapedDomain + "(.*)$",
        action: "redirect",
        target: "$1://" + ip + "$2",
        setHost: domain,
      });
      continue;
    }

    if (src.startsWith("^")) {
      const domain = src.slice(1);
      let pattern: string;
      if (domain.includes("/***")) {
        const idx = domain.indexOf("/***");
        const host = domain.slice(0, idx).replace(/\./g, "\\.").replace(/\*/g, "[^/]*");
        pattern = "^https?://" + host + "/(.*)$";
      } else {
        const escaped = domain
          .replace(/\./g, "\\.")
          .replace(/\*\*\*/g, "(.*)")
          .replace(/\*\*/g, "(.*)")
          .replace(/\*/g, "[^/]*");
        pattern = "^https?://" + escaped + "(.*)$";
      }
      rules.push({ pattern, action: "redirect", target: dst });
      continue;
    }

    if (src.startsWith("http://") || src.startsWith("https://")) {
      const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      rules.push({ pattern: "^" + escaped + "(.*)$", action: "redirect", target: dst + "$1" });
      continue;
    }

    if (dst.startsWith("http://") || dst.startsWith("https://")) {
      const escaped = src.replace(/\./g, "\\.").replace(/\*/g, "[^.]*");
      rules.push({
        pattern: "^https?://" + escaped + "(.*)$",
        action: "redirect",
        target: dst + "$1",
      });
    }
  }
  return rules;
}

export function ruleToWhistle(r: any): string {
  const src = patternToSource(r.pattern || "");
  if (r.action === "disable") return src + " disable://";
  if (r.action === "block") return src + " block://";
  if (r.action === "header" && r.setHeaders) {
    const headerStr = Object.entries(r.setHeaders)
      .map(([k, v]) => k + ": " + v)
      .join("\\n");
    return src + " reqHeaders://(" + headerStr + ")";
  }
  if (r.action === "resHeader" && r.setHeaders) {
    const headerStr = Object.entries(r.setHeaders)
      .map(([k, v]) => k + ": " + v)
      .join("\\n");
    return src + " resHeaders://(" + headerStr + ")";
  }
  if (r.action === "mock") {
    const status = r.response?.status || 200;
    const body = r.response?.body || "";
    return src + " mock://" + status + (body ? " " + body : "");
  }
  if (r.action === "delay") return src + " delay://" + (r.delay || 0);
  if (r.action !== "redirect") return "# [" + (r.action || "unknown") + "] " + (r.pattern || "");

  const target = r.target || "";
  if (r.setHost) {
    const ipMatch = target.match(/^\$1:\/\/(\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?)\$2$/);
    if (ipMatch) return ipMatch[1] + " " + r.setHost;
    const hostMatch = target.match(/^\$1:\/\/([^$]+)\$2$/);
    if (hostMatch) return "host://" + hostMatch[1] + " " + r.setHost;
  }
  if (!r.setHost && /^\$1:\/\//.test(target) && /\$2$/.test(target)) {
    const inner = target.replace(/^\$1:\/\//, "").replace(/\$2$/, "");
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(inner)) return inner + " " + src;
    return "host://" + inner + " " + src;
  }
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return src + " " + target.replace(/\$1$/, "");
  }
  if (src.includes("/***")) return "^" + src + " " + target;
  if (/\$1(?!$)/.test(target)) return "^" + src + "/*** " + target;
  return src + " " + target.replace(/\$\d+$/, "");
}

export function rulesToWhistle(rules: any[]): string {
  const hostGroups: Record<string, string[]> = {};
  const otherRules: any[] = [];
  for (const r of rules) {
    if (r.action === "redirect" && r.setHost) {
      const tm = (r.target || "").match(/^\$1:\/\/([^$]+)\$2$/);
      if (tm) {
        const targetHost = tm[1];
        if (!/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(targetHost)) {
          if (!hostGroups[targetHost]) hostGroups[targetHost] = [];
          hostGroups[targetHost].push(r.setHost);
          continue;
        }
      }
    }
    otherRules.push(r);
  }
  const lines: string[] = [];
  for (const [target, domains] of Object.entries(hostGroups)) {
    lines.push("host://" + target + " " + domains.join(" "));
  }
  lines.push(...otherRules.map(ruleToWhistle));
  return lines.join("\n");
}
