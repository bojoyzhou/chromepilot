---
name: chromepilot
description: Pilots AI agents through the user's real Chrome browser via a lightweight extension. Runs JS in page context with full login session, captures network traffic, manages cookies, intercepts requests, and applies rich proxy rules (mock/block/redirect/delay/header/resHeader/disable). Manages per-tab and global proxy with auto-persistence, Whistle-compatible rule format, environment isolation headers (Alibaba dpath_env/scm_project), CORS auto-fix, host mapping (IP and hostname), and real-time hit logging. Use when the agent needs to: interact with authenticated web pages, inspect/mock API calls, switch pre-release environments, block/redirect requests, add custom headers, debug CORS issues, or automate browser tasks that require the user's session.
---

# ChromePilot — AI Agent's Chrome Pilot

Execute JS in the user's actual Chrome browser with full page context (login session, cookies, localStorage). Unlike CDP-based tools, ChromePilot uses a Chrome Extension that runs in the MAIN world — fetch calls inherit the page's auth automatically.

## Prerequisites & Installation

### Quick Check

```bash
python3 cp.py status    # Check server + extension status
```

If the output shows `Extension: ✓ Connected`, ChromePilot is ready. Otherwise follow the setup guide below.

### One-Line Setup (Recommended)

Guide the user to run the setup script from the ChromePilot directory:

```bash
bash setup.sh
```

The script automates all steps: dependency install → server auto-start (LaunchAgent) → Chrome extension loading → connection verification → CLI shortcut (`cp-pilot`).

To uninstall: `bash setup.sh --uninstall`

### Manual Setup (Step-by-Step)

If the user prefers manual installation or is on a non-macOS system, walk them through these steps:

**Step 1 — Install Python dependency:**
```bash
pip3 install aiohttp
```

**Step 2 — Start the server:**
```bash
python3 server.py    # Keep running; or set up as system service (see below)
```

**Step 3 — Install Chrome extension:**
1. Open Chrome, navigate to `chrome://extensions/`
2. Enable "Developer mode" toggle (top-right corner)
3. Click "Load unpacked" button (top-left)
4. Select the `extension/` subdirectory inside the ChromePilot folder
5. ChromePilot should appear in the extensions list with a colored icon

**Step 4 — Verify connection:**
```bash
python3 cp.py status
# Expected: Extension: ✓ Connected
```

### macOS Auto-Start (LaunchAgent)

The `setup.sh` script creates a LaunchAgent at `~/Library/LaunchAgents/com.chromepilot.server.plist` so the server starts automatically on login. If the user needs to set this up manually:

```bash
# The plist points python3 to server.py with KeepAlive=true
# Logs: ~/Library/Logs/chromepilot/chromepilot.log
launchctl load ~/Library/LaunchAgents/com.chromepilot.server.plist
```

**Important — macOS TCC restriction:** If server.py is located in a protected directory (`~/Documents`, `~/Desktop`, etc.), the user must grant Full Disk Access to `/usr/bin/python3`:
- System Settings → Privacy & Security → Full Disk Access → add `/usr/bin/python3`

### Troubleshooting Installation

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Extension: ✗ Disconnected` | Server not running, or extension not loaded | Check `launchctl list \| grep chromepilot` and Chrome extensions page |
| Server exits with code 2 | `Operation not permitted` on macOS | Grant Full Disk Access to python3 (see above) |
| Extension icon is gray | Extension loaded but can't reach server | Ensure server is running on port 8787: `curl http://127.0.0.1:8787/status` |
| "Cannot attach debugger" | DevTools is open on the target tab | Close DevTools on that tab first |
| `aiohttp` import error | Dependency not installed | `pip3 install aiohttp` |
| Port 8787 in use | Another process occupying the port | `lsof -i :8787` to find and kill it |

## Core Workflow

1. **Inspect**: `cp tabs` — list browser tabs with IDs
2. **Target**: use `--tab ID` or `--url MATCH` to target a specific tab
3. **Execute**: `cp eval 'expression'` — run JS in page context
4. **Capture**: `cp net start` → interact → `cp net requests` — see all API calls
5. **Extract**: `cp net body REQUEST_ID` — get response payload
6. **Repeat**: browser stays open, session persists between commands

## Commands

### Tab Management

```bash
cp tabs                              # List all tabs with IDs
cp tab create [URL]                  # Open new tab
cp tab close TAB_ID                  # Close tab
cp tab reload [--tab ID]             # Reload (--no-cache to bypass)
cp tab activate TAB_ID               # Bring tab to front
```

### JS Execution (MAIN World)

```bash
cp eval 'document.title'             # Run JS in active tab
cp eval 'fetch("/api/data").then(r=>r.json())' --url mysite  # Fetch with session
cp eval -f script.js --tab 12345     # Execute JS file
cp eval 'expr' --isolated            # Run in ISOLATED world (no page vars)
```

Key advantage: `eval` runs in the page's MAIN world. `fetch()` calls inherit cookies and auth headers automatically — no token management needed.

### Navigation

```bash
cp navigate https://example.com              # Open in new tab
cp navigate https://example.com --tab 123    # Navigate existing tab
cp navigate https://example.com --wait       # Wait for page load
```

### Network Capture

```bash
cp net start [--tab ID]                      # Start capturing
cp net requests                              # List all captured requests
cp net requests --filter "api/v1" --method POST  # Filter by URL and method
cp net requests --type Fetch --completed     # Only completed Fetch requests
cp net requests -v                           # Show request IDs (for body)
cp net body REQUEST_ID                       # Get response body (auto pretty-prints JSON)
cp net body REQUEST_ID -o resp.json          # Save body to file
cp net clear                                 # Clear buffer
cp net stop                                  # Stop capture
```

Network capture uses Chrome DevTools Protocol via the debugger API. A "debugging" banner appears on the tab — this is normal and expected.

### Network Interception

Mock or modify API responses in real-time:

```bash
# Mock a single endpoint
cp net intercept '[{"urlPattern":"api/users","response":{"status":200,"body":"{\"name\":\"test\"}"}}]'

# Multiple rules
cp net intercept '[
  {"urlPattern":"api/auth","response":{"status":401,"body":"unauthorized"}},
  {"urlPattern":"api/data","response":{"status":200,"headers":{"x-custom":"val"},"body":"{}"}}
]'

# Stop interception
cp net intercept-stop
```

Rules format: `[{"urlPattern": "regex", "response": {"status": int, "headers": {}, "body": "string"}}]`

Unmatched requests pass through normally.

### Console Capture

```bash
cp console start [--tab ID]          # Start capturing console output
cp console messages                  # Show all messages
cp console messages --level error    # Filter: log, warn, error, info, debug, exception
cp console messages -n 20            # Last 20 messages
cp console clear                     # Clear buffer
cp console stop                      # Stop capture
```

### Cookie Management

```bash
cp cookie list                                       # All cookies
cp cookie list --domain .example.com                 # Filter by domain
cp cookie list --url https://example.com             # Filter by URL
cp cookie set --url https://example.com --name foo --value bar
cp cookie set --url https://example.com --name s --value v --secure --httponly
cp cookie delete --url https://example.com --name foo
```

### Screenshot

```bash
cp screenshot                        # Save as screenshot.png
cp screenshot output.png             # Custom filename
cp screenshot --tab 123 --format jpeg shot.jpg
```

### Page Info

```bash
cp page                              # Current tab metrics
cp page --url mysite                 # Specific tab
```

Shows: URL, title, readyState, content type, cookie count, localStorage/sessionStorage key count, page load timing.

### Storage (localStorage / sessionStorage)

```bash
cp storage list                      # List localStorage keys
cp storage list --session            # List sessionStorage keys
cp storage get myKey                 # Get value (auto pretty-prints JSON)
cp storage set myKey "value"         # Set value
cp storage get token --session       # Get from sessionStorage
```

### Proxy Rules (mock / block / redirect / delay / header / resHeader / disable)

Rich request interception with 7 rule types, hit logging, hot-reload, and auto-persistence. Rules survive server restarts — ChromePilot persists them to `proxy-rules.json` and replays automatically on reconnect.

> **Agent must use JSON `rules` array** — the HTTP API and CLI both consume structured JSON rules. Whistle text (`whistleText`) is only for the popup UI display; the extension always executes the `rules` array, never the Whistle text string. If you send `whistleText` without `rules`, nothing happens.

#### Two Proxy Modes

| | Per-tab | Global |
|---|---|---|
| Scope | Single tab | ALL tabs (including new ones) |
| Best for | Targeted debugging on one page | Environment switching, site-wide blocking |
| Start | `POST /proxy/start` with `tabId` or `urlMatch` | `POST /proxy/start-global` |
| Stop | `POST /proxy/stop` | `POST /proxy/stop-global` |

When both modes are active: a tab with its own per-tab proxy uses only those rules; other tabs use global rules. Per-tab rules fully replace (not merge with) global rules on that tab.

#### How to Start Proxy (Agent Step-by-Step)

**Step 1 — Build `rules` array.** Each rule is a JSON object with `pattern` (JS regex matched against full URL) and `action`:

```json
[
  {"pattern": "REGEX_TO_MATCH_URL", "action": "ACTION_TYPE", ...action-specific fields...}
]
```

**Step 2 — Call the HTTP API:**

```bash
# Global proxy (recommended for most scenarios)
curl -X POST http://localhost:8787/proxy/start-global \
  -H "Content-Type: application/json" \
  -d '{"rules": [RULES_ARRAY], "whistleText": "WHISTLE_TEXT_FOR_POPUP_DISPLAY"}'

# Per-tab proxy (by tab ID)
curl -X POST http://localhost:8787/proxy/start \
  -H "Content-Type: application/json" \
  -d '{"tabId": TAB_ID, "rules": [RULES_ARRAY]}'

# Per-tab proxy (by URL match — auto-resolves to tab ID)
curl -X POST http://localhost:8787/proxy/start \
  -H "Content-Type: application/json" \
  -d '{"urlMatch": "URL_SUBSTRING", "rules": [RULES_ARRAY]}'
```

**Step 3 — Verify** by checking hit log after user interaction:

```bash
curl "http://localhost:8787/proxy/log?limit=10"               # Global
curl "http://localhost:8787/proxy/log?tabId=TAB_ID&limit=10"  # Per-tab
```

#### Rule JSON Format — Complete Reference

**CRITICAL format requirements:**
- `pattern` is a **JavaScript regex string**, not a glob. Dots in domain names MUST be escaped: `expressexport\\.alibaba\\.com` (double-escaped in JSON string: `"expressexport\\\\.alibaba\\\\.com"`).
- `response.body` MUST be a string, not an object. Use `"{\"key\":\"value\"}"` not `{"key":"value"}`.
- `setHeaders` keys are **case-sensitive**. Use exact header names: `EagleEye-UserData`, not `eagleeye-userdata`.

**All 7 action types with copy-paste examples:**

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

**Rule evaluation order for each request:**
1. `disable` rules checked first — if matched, request passes through immediately, all other rules skipped.
2. All matching `header` rules collected and merged into one header set.
3. First matching non-header/non-resHeader rule becomes the "main action" (mock/block/redirect/delay).
4. Merged header modifications applied alongside the main action.
5. `resHeader` rules applied independently at response stage.

#### Managing Running Proxy

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

# Stop
curl -X POST http://localhost:8787/proxy/stop \
  -H "Content-Type: application/json" \
  -d '{"tabId": TAB_ID}'
curl -X POST http://localhost:8787/proxy/stop-global
```

Response format:
```jsonc
// proxy/start       → {"ok": true, "tabId": 12345, "ruleCount": 3}
// proxy/start-global→ {"ok": true, "global": true, "ruleCount": 3, "tabCount": 8}
// proxy/rules       → {"data": [...rules...], "active": true, "tabId": 12345}
// proxy/log         → {"data": [...log entries...], "total": 42}
```

#### CLI Commands (alternative to HTTP API)

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

### Whistle Text Format (for Popup UI Display)

The `whistleText` field is an **optional display string** sent alongside `rules` in API calls. It lets the popup UI show a human-readable form of the rules. The extension **never** parses `whistleText` from the API — it only uses the `rules` array.

However, the popup UI's built-in editor **does** parse Whistle text when the user edits rules manually in the popup. Here is the Whistle syntax reference:

```
# Lines starting with # are comments
# Format: SOURCE_PATTERN TARGET

# ── Redirect ──
^cdn.example.com/@g/*** http://dev.cdn.com/$1
https://prod.example.com https://staging.example.com

# ── IP Host Mapping (IP DOMAIN) ──
140.205.215.168 api.example.com

# ── Hostname Host Mapping (host://TARGET_HOST DOMAIN1 DOMAIN2 ...) ──
host://upstream.example.com api.example.com cdn.example.com

# ── Request Header (PATTERN reqHeaders://(Name: Value)) ──
*.example.com reqHeaders://(X-Debug: true)
expressexport.alibaba.com reqHeaders://(EagleEye-UserData: dpath_env=my-tag)

# ── Response Header (PATTERN resHeaders://(Name: Value)) ──
api.example.com resHeaders://(Access-Control-Allow-Origin: *)

# ── Bypass (PATTERN disable://) ──
cdn.safe.com disable://
```

**Key syntax details:**
- `host://target domain1 domain2` — one line maps multiple domains to the same upstream. Each domain becomes a separate redirect+setHost rule.
- `reqHeaders://` and `resHeaders://` — parentheses `()` around the header value are optional but recommended for readability. The header content (including spaces, colons) inside the parentheses is preserved as-is.
- IP host mapping: `IP DOMAIN` — the IP comes first, domain second (reversed from `host://` syntax).

### Alibaba Environment Isolation

To route requests to a project environment (Aone), use `header` rules to inject the isolation tag. This is the **most common proxy use case**.

**Pre-release environment** (最常用):

```bash
# Agent should send this:
curl -X POST http://localhost:8787/proxy/start-global \
  -H "Content-Type: application/json" \
  -d '{
    "rules": [
      {
        "pattern": "expressexport\\.alibaba\\.com",
        "action": "header",
        "setHeaders": {"EagleEye-UserData": "dpath_env=YOUR_TAG"}
      }
    ],
    "whistleText": "expressexport.alibaba.com reqHeaders://(EagleEye-UserData: dpath_env=YOUR_TAG)"
  }'
```

**Daily environment**: use `scm_project=TAG` instead of `dpath_env=TAG` in the header value.

**With IP host mapping** (route to specific pre-release server):

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
        "setHeaders": {"EagleEye-UserData": "dpath_env=YOUR_TAG"}
      }
    ],
    "whistleText": "203.119.204.7 expressexport.alibaba.com\nexprexport.alibaba.com reqHeaders://(EagleEye-UserData: dpath_env=YOUR_TAG)"
  }'
```

> **Format trap — `setHost` is required for IP mapping.** Without it, HTTPS requests to an IP address will fail TLS validation because the certificate is issued for the domain, not the IP. `setHost` tells the extension to route through `server.py`'s custom DNS resolver which preserves TLS SNI.

**To check the current isolation tag:** read `proxy-rules.json` in the project root directory, or call `curl "http://localhost:8787/proxy/rules?tabId=TAB_ID"`.

### Smart CORS Handling

When `resHeaders://` sets `Access-Control-Allow-Origin: *`, ChromePilot automatically replaces `*` with the actual request origin (from `Origin` or `Referer` header) and adds `Access-Control-Allow-Credentials: true`. This is essential because modern browsers reject wildcard CORS when credentials (cookies) are included.

### Rule Persistence & Auto-Replay

All proxy rules are automatically persisted to `proxy-rules.json`. On server restart or extension reconnect, rules replay automatically. The file format:

```json
{
  "_global": {"rules": [...], "whistleText": "..."},
  "12345": {"rules": [...], "urlMatch": "myapp.com", "whistleText": "..."}
}
```

`_global` = global proxy. Numeric keys = per-tab rules (key is Chrome tab ID). The agent can read this file to inspect current rules, though the HTTP API is preferred.

### Global Proxy Pause/Resume

The popup UI includes a toggle to pause/resume global proxy without losing rules. When paused, Fetch interception is disabled but rules and hit log are preserved. Resuming re-enables interception instantly.

### Popup UI — Active Tab View

The extension popup (click icon → Proxy tab) shows:

1. **当前标签页** — Active tab URL + all matching rules from both global and per-tab, with source tags (蓝色=全局, 橙色=标签页).
2. **标签页代理** — Per-tab rules editor, hit log, stop/clear controls for active tab.
3. **其他标签页代理** — Lists other tabs with per-tab proxies.
4. **全局代理** — Status toggle, rule editor, aggregated hit log, stop button.

## Global Options

| Option | Description |
|--------|-------------|
| `--port PORT` | Server port (default: 8787) |
| `--json` | Output raw JSON for programmatic use |
| `--tab ID` | Target tab by Chrome tab ID |
| `--url MATCH` | Target tab by URL substring match |

Tab targeting priority: explicit `--tab` > `--url` match > active tab.

## Common Agent Workflows

### Explore an Authenticated Web App

```bash
cp tabs                                    # Find the target tab
cp net start --url myapp                   # Start capturing
cp eval 'location.reload()' --url myapp    # Trigger page load
cp net requests --type Fetch --completed   # See all API calls
cp net body REQ_ID                         # Inspect response payload
cp cookie list --url https://myapp.com     # Check auth cookies
cp storage list --url myapp                # Check stored tokens
```

### Test API Behavior with Mocking

```bash
cp net start --url myapp
cp net intercept '[{"urlPattern":"api/pricing","response":{"status":200,"body":"{\"price\":0}"}}]' --url myapp
cp eval 'document.querySelector(".refresh-btn").click()' --url myapp
cp console messages --level error          # Check for errors
cp net intercept-stop --url myapp
```

### Extract Data from Internal Tools

```bash
# The user is already logged into an internal tool in Chrome
cp eval 'fetch("/api/projects").then(r=>r.json())' --url internal-tool
```

No auth setup needed — the extension reuses the browser's existing session.

### Switch to Pre-Release Environment (Alibaba) — Complete Example

This is the most common proxy scenario. Full working example for `expressexport.alibaba.com` with IP mapping + environment isolation:

```bash
# Step 1: Start global proxy (rules + whistleText for popup display)
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
# Expected: {"ok":true,"global":true,"ruleCount":2,"tabCount":17}

# Step 2: Reload the target page
cp tab reload --url expressexport

# Step 3: Check proxy hit log to verify
curl -s "http://localhost:8787/proxy/log?limit=5"
# Should show entries with action:"redirect" and headerMods:"EagleEye-UserData"
```

If you only need the header (no IP mapping), simplify to just the `header` rule:
```bash
curl -X POST http://localhost:8787/proxy/start-global \
  -H "Content-Type: application/json" \
  -d '{
    "rules": [
      {"pattern": "expressexport\\.alibaba\\.com", "action": "header", "setHeaders": {"EagleEye-UserData": "dpath_env=YOUR_TAG"}}
    ],
    "whistleText": "expressexport.alibaba.com reqHeaders://(EagleEye-UserData: dpath_env=YOUR_TAG)"
  }'
```

### Block Unwanted Requests Site-Wide

```bash
curl -X POST http://localhost:8787/proxy/start-global \
  -H "Content-Type: application/json" \
  -d '{"rules": [
    {"pattern": "google-analytics\\.com", "action": "block"},
    {"pattern": "hotjar\\.com", "action": "block"},
    {"pattern": "sentry\\.io/api", "action": "block"}
  ]}'
```

### Debug CORS Issues

```bash
curl -X POST http://localhost:8787/proxy/start-global \
  -H "Content-Type: application/json" \
  -d '{"rules": [
    {"pattern": "api\\.backend\\.com", "action": "resHeader", "setHeaders": {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }}
  ]}'
```

The `*` origin is auto-replaced with the actual request origin for credentials support.

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

The `disable` rule ensures CDN assets are not affected by the proxy.

### Simulate Slow Network for Performance Testing

```bash
cp proxy start '[
  {"pattern": "api/heavy-endpoint", "action": "delay", "delay": 3000},
  {"pattern": "\\.js$", "action": "delay", "delay": 1000}
]' --url myapp
# Interact with the page, then check which requests were delayed
cp proxy log --url myapp
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

## Architecture

```
CLI (cp.py) → HTTP → server.py → WebSocket → Chrome Extension → Chrome APIs
                                                    ↓
                                            MAIN world execution
                                            (page context + cookies)
```

Components:
- **Chrome Extension** (MV3): service worker connects to local server via WebSocket, executes commands using Chrome APIs (scripting, debugger, cookies, tabs)
- **ChromePilot Server** (Python/aiohttp): HTTP REST API for CLI, WebSocket relay to extension, SSE event streaming
- **CLI** (Python): human-friendly and `--json` machine-friendly output, zero dependencies beyond Python stdlib

## Tips

- Always run `cp tabs` first to see available tabs and their IDs
- Use `--url` for convenience (matches substring), `--tab` for precision
- Network capture requires debugger attachment — close DevTools on the target tab first
- `cp eval` in MAIN world can access any page variable or API
- Use `--json` flag when parsing output programmatically
- If commands fail, check `cp status` to verify extension connection

## Troubleshooting

- **"Extension not connected"**: Check server is running (`curl http://127.0.0.1:8787/status`), then check Chrome has the extension loaded and enabled
- **Server won't start on macOS**: If server.py is in `~/Documents` or other protected folders, grant Full Disk Access to `/usr/bin/python3` in System Settings → Privacy & Security
- **"Cannot attach debugger"**: Close DevTools on the target tab (only one debugger at a time)
- **Network body unavailable**: Must call `cp net body` while capture is still active
- **Server won't start**: Check if port 8787 is already in use (`lsof -i :8787`)
- **Extension disappeared after Chrome update**: Re-run `bash setup.sh` or manually reload from `chrome://extensions/`
- **Global proxy not working on new tabs**: Ensure global proxy is not paused (check Popup UI toggle switch)
