// Cookie handlers
// Extracted from legacy.ts HANDLERS

export const cookieHandlers = {
  async cookie_list(cmd: any) {
    const query: Record<string, string> = {};
    if (cmd.domain) query.domain = cmd.domain;
    if (cmd.url) query.url = cmd.url;
    if (cmd.name) query.name = cmd.name;
    const cookies = await chrome.cookies.getAll(query);
    return { data: cookies };
  },

  async cookie_set(cmd: any) {
    const cookie = await chrome.cookies.set({
      url: cmd.url,
      name: cmd.name,
      value: cmd.value,
      domain: cmd.domain,
      path: cmd.path || "/",
      secure: !!cmd.secure,
      httpOnly: !!cmd.httpOnly,
      sameSite: cmd.sameSite || "lax",
      expirationDate: cmd.expirationDate,
    });
    return { ok: true, cookie };
  },

  async cookie_delete(cmd: any) {
    await chrome.cookies.remove({ url: cmd.url, name: cmd.name });
    return { ok: true };
  },
};
