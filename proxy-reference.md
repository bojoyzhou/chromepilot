# Proxy Rules — Complete Reference

This is the detailed reference for ChromePilot proxy rules. For quick-start and essential usage, see [SKILL.md](SKILL.md).

## All 7 Action Types with Examples

```jsonc
[
  // 1. mock — Return a custom response (body MUST be string)
  {
    "pattern": "api/users/me",
    "action": "mock",
    "response": {"status": 200, "body": "{\"name\":\"test\"}", "headers": {"Content-Type": "application/json"}}
  },

  // 2. block — Fail the request with a network error
  {
    "pattern": "tracking\\.js",
    "action": "block"
  },

  // 3. redirect — Reroute URL, supports $1 capture groups from pattern
  {
    "pattern": "^https?://old\\.api\\.com/(.*)",
    "action": "redirect",
    "target": "https://new.api.com/$1"
  },

  // 4. redirect + setHost — IP/hostname mapping, preserves original Host header for TLS SNI
  //    Use this for host:// style rules (route domain to different server)
  {
    "pattern": "^(https?)://api\\.example\\.com(.*)",
    "action": "redirect",
    "target": "$1://10.0.0.1$2",
    "setHost": "api.example.com"
  },

  // 5. header — Modify REQUEST headers (stackable: multiple header rules all apply)
  {
    "pattern": "expressexport\\.alibaba\\.com",
    "action": "header",
    "setHeaders": {"EagleEye-UserData": "dpath_env=coupon-unbind"}
  },

  // 6. resHeader — Modify RESPONSE headers (stackable, applies at response stage)
  {
    "pattern": "api\\.backend\\.com",
    "action": "resHeader",
    "setHeaders": {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true"}
  },

  // 7. delay — Add latency (ms) before forwarding
  {
    "pattern": "api/slow-endpoint",
    "action": "delay",
    "delay": 2000
  },

  // 8. disable — Bypass proxy entirely for matched URLs (highest priority)
  {
    "pattern": "cdn\\.safe\\.com",
    "action": "disable"
  }
]
```

## Rule Evaluation Order

For each intercepted request:

1. `disable` rules checked first — if matched, request passes through immediately, all other rules skipped.
2. All matching `header` rules collected and merged into one header set.
3. First matching non-header/non-resHeader rule becomes the "main action" (mock/block/redirect/delay).
4. Merged header modifications applied alongside the main action.
5. `resHeader` rules applied independently at response stage.

## Format Traps

- `pattern` is a **JavaScript regex string**, not a glob. Dots in domain names MUST be escaped: `expressexport\\.alibaba\\.com` (double-escaped in JSON string: `"expressexport\\\\.alibaba\\\\.com"`).
- `response.body` MUST be a string, not an object. Use `"{\"key\":\"value\"}"` not `{"key":"value"}`.
- `setHeaders` keys are **case-sensitive**. Use exact header names: `EagleEye-UserData`, not `eagleeye-userdata`.
- `setHost` is **required** for IP mapping. Without it, HTTPS requests to an IP address will fail TLS validation because the certificate is issued for the domain, not the IP. `setHost` tells the extension to route through `server.py`'s custom DNS resolver which preserves TLS SNI.

## Managing Running Proxy

```bash
# Hot-update rules (no restart needed)
curl -X POST http://localhost:8787/proxy/update \
  -H "Content-Type: application/json" \
  -d '{"tabId": TAB_ID, "rules": [NEW_RULES]}'

# Query what rules are active
curl "http://localhost:8787/proxy/rules?tabId=TAB_ID"

# Query hit log
curl "http://localhost:8787/proxy/log?tabId=TAB_ID&limit=50"

# Clear hit log
curl -X POST http://localhost:8787/proxy/clear-log \
  -H "Content-Type: application/json" \
  -d '{"tabId": TAB_ID}'

# Stop per-tab
curl -X POST http://localhost:8787/proxy/stop \
  -H "Content-Type: application/json" \
  -d '{"tabId": TAB_ID}'

# Stop global
curl -X POST http://localhost:8787/proxy/stop-global
```

## API Response Formats

```jsonc
// proxy/start        → {"ok": true, "tabId": 12345, "ruleCount": 3}
// proxy/start-global → {"ok": true, "global": true, "ruleCount": 3, "tabCount": 8}
// proxy/rules        → {"data": [...rules...], "active": true, "tabId": 12345}
// proxy/log          → {"data": [...log entries...], "total": 42}
// proxy/stop         → {"ok": true}
// proxy/update       → {"ok": true, "ruleCount": N}
```

## CLI Commands (alternative to HTTP API)

```bash
cp proxy start '[RULES_JSON]' --url myapp    # Start per-tab proxy
cp proxy start -f rules.json --url myapp     # Load rules from file
cp proxy list --url myapp                    # Show active rules
cp proxy log --url myapp                     # View hit log
cp proxy update '[NEW_RULES]' --url myapp    # Hot-update rules
cp proxy clear-log --url myapp               # Clear hit log
cp proxy stop --url myapp                    # Stop proxy
```

Note: Global proxy cannot be managed via CLI — use the HTTP API (`/proxy/start-global`, `/proxy/stop-global`).

## Whistle Text Format — Unified Bidirectional Format

Whistle text is the **canonical human-readable format** for proxy rules. Both the side panel editor and the API `whistleText` field use the same syntax. Rules written in Whistle text can be parsed to JSON rules, and JSON rules convert back to identical Whistle text (round-trip safe).

The extension **always executes the `rules` JSON array**. Whistle text serves as the editable representation. When the user saves edits in the side panel, Whistle text is parsed into rules. When rules are created via API, `rulesToWhistle()` generates the display text.

### Complete Syntax Reference

```
# Lines starting with # are comments
# Format: SOURCE TARGET

# ── Redirect ──
domain.com http://target.com                # Plain domain redirect (auto path forwarding)
https://prod.example.com https://staging.example.com   # URL-to-URL redirect
^cdn.example.com/*** http://dev.cdn.com/$1  # Regex redirect with path capture

# ── Host Mapping (IP or hostname) ──
140.205.215.168 api.example.com             # IP host mapping (preserve Host & TLS)
127.0.0.1:6001 pre-icbu-agent.alibaba-inc.com  # IP with port
host://upstream.example.com api.example.com cdn.example.com  # Hostname mapping (multi-domain)

# ── Request / Response Headers ──
*.example.com reqHeaders://(X-Debug: true)
expressexport.alibaba.com reqHeaders://(EagleEye-UserData: dpath_env=my-tag)
api.example.com resHeaders://(Access-Control-Allow-Origin: *)

# ── Intercept Control ──
tracking.js block://                        # Block (network error)
api/users mock://200 {"name":"test"}        # Mock (custom response)
api/users mock://404                        # Mock (status only)
api/slow-endpoint delay://2000              # Delay (ms latency)
cdn.safe.com disable://                     # Bypass proxy (highest priority)
```

### Key syntax details

- **Plain domain redirect** (`domain.com http://target`): Automatically forwards the URL path. `domain.com/path` → `http://target/path`.
- **IP host mapping** (`IP DOMAIN`): IP comes first, domain second. Generates `setHost` for TLS SNI preservation.
- **host://** (`host://target domain1 domain2`): One line maps multiple domains to the same upstream. Each domain becomes a separate redirect+setHost rule.
- **reqHeaders:// / resHeaders://**: Parentheses `()` around the header value are optional but recommended. The header content (including spaces, colons) is preserved as-is.
- **block://**: Fails the request with a network error (different from `disable://` which passes through).
- **mock://STATUS [BODY]**: Returns a custom response. If body starts with `{` or `[`, auto-sets `Content-Type: application/json`.
- **delay://MS**: Adds latency in milliseconds before forwarding the request.

## Smart CORS Handling

When `resHeaders://` sets `Access-Control-Allow-Origin: *`, ChromePilot automatically replaces `*` with the actual request origin (from `Origin` or `Referer` header) and adds `Access-Control-Allow-Credentials: true`. This is essential because modern browsers reject wildcard CORS when credentials (cookies) are included.

## Rule Persistence & Auto-Replay

All proxy rules are automatically persisted to `proxy-rules.json`. On server restart or extension reconnect, rules replay automatically. The file format:

```json
{
  "_global": {"rules": [...], "whistleText": "..."},
  "12345": {"rules": [...], "urlMatch": "myapp.com", "whistleText": "..."}
}
```

`_global` = global proxy. Numeric keys = per-tab rules (key is Chrome tab ID). The agent can read this file to inspect current rules, though the HTTP API is preferred.

## Global Proxy Pause/Resume

The side panel UI includes a toggle to pause/resume global proxy without losing rules. When paused, Fetch interception is disabled but rules and hit log are preserved. Resuming re-enables interception instantly.

## Popup UI — Active Tab View

The extension side panel (click icon → Proxy tab) shows:

1. **当前标签页** — Unified card for the active tab. Header shows tab URL, rule count badge, and an **编辑** toggle button. Body lists **all** per-tab rules (unfiltered) plus matching global rules, each with a colored source tag (蓝色「全局」= global, 橙色「标签页」= per-tab). Action types are color-coded: redirect (blue), reqHeaders/resHeaders (teal), block (red), mock (orange), delay (yellow), disable (gray). When edit mode is on, a Whistle text editor replaces the rule list, with real-time save. Hit log (命中日志) and stop/clear controls are integrated at the bottom of the same card.
2. **其他标签页代理** — Lists other tabs that have per-tab proxies. Each entry shows tab title, rule count, and a **复制到当前** button. Clicking this button copies that tab's proxy rules (including Whistle text) to the active tab via `proxyStartTab`, enabling quick rule reuse across tabs.
3. **全局代理** — Status toggle (pause/resume), rule editor (Whistle text), aggregated hit log, stop button.

## IP Mapping with Environment Isolation

Complete example routing `expressexport.alibaba.com` to a specific IP + injecting pre-release header:

```bash
curl -X POST http://localhost:8787/proxy/start-global \
  -H "Content-Type: application/json" \
  -d '{
    "rules": [
      {
        "pattern": "^(https?)://expressexport\\.alibaba\\.com(.*)",
        "action": "redirect",
        "target": "$1://203.119.204.7$2",
        "setHost": "expressexport.alibaba.com"
      },
      {
        "pattern": "expressexport\\.alibaba\\.com",
        "action": "header",
        "setHeaders": {"EagleEye-UserData": "dpath_env=coupon-unbind"}
      }
    ],
    "whistleText": "203.119.204.7 expressexport.alibaba.com\nexprexport.alibaba.com reqHeaders://(EagleEye-UserData: dpath_env=coupon-unbind)"
  }'
```

## Additional Workflow Examples

### Redirect API to Local Dev Server

```bash
curl -X POST http://localhost:8787/proxy/start \
  -H "Content-Type: application/json" \
  -d '{
    "urlMatch": "myapp.com",
    "rules": [
      {"pattern": "^https://myapp\\.com/api/(.*)", "action": "redirect", "target": "http://localhost:3000/api/$1"},
      {"pattern": "cdn\\.myapp\\.com", "action": "disable"}
    ]
  }'
```

### Simulate Slow Network

```bash
cp proxy start '[
  {"pattern": "api/heavy-endpoint", "action": "delay", "delay": 3000},
  {"pattern": "\\.js$", "action": "delay", "delay": 1000}
]' --url myapp
```

### Combine Multiple Rule Types

Rules compose naturally — header modifiers stack with the main action:

```bash
curl -X POST http://localhost:8787/proxy/start \
  -H "Content-Type: application/json" \
  -d '{
    "urlMatch": "myapp.com",
    "rules": [
      {"pattern": "api\\.myapp\\.com", "action": "header", "setHeaders": {"X-Debug": "1", "X-Feature-Flag": "new-ui"}},
      {"pattern": "api\\.myapp\\.com/v1/users", "action": "redirect", "target": "http://localhost:8080/v1/users"},
      {"pattern": "api\\.myapp\\.com/health", "action": "disable"}
    ]
  }'
```

Requests to `/v1/users` are redirected to localhost AND get the debug headers. `/health` bypasses the proxy entirely.
