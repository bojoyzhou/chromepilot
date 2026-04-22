---
name: chromepilot
description: "Pilots AI agents through the user's real Chrome browser via a lightweight extension. Runs JS in page context with full login session, captures network traffic, manages cookies, intercepts requests, and applies rich proxy rules (mock/block/redirect/delay/header/resHeader/disable). Manages per-tab and global proxy with auto-persistence, Whistle-compatible rule format, environment isolation headers (Alibaba dpath_env/scm_project), CORS auto-fix, host mapping (IP and hostname), and real-time hit logging. Use when the agent needs to interact with authenticated web pages, inspect/mock API calls, switch pre-release environments, block/redirect requests, add custom headers, debug CORS issues, or automate browser tasks that require the user's session."
---

# ChromePilot — AI Agent's Chrome Pilot

Execute JS in the user's actual Chrome browser with full page context (login session, cookies, localStorage). The Chrome Extension runs in the MAIN world — fetch calls inherit the page's auth automatically.

## Prerequisites & Installation

```bash
python3 cp.py status    # Quick check: Extension: ✓ Connected = ready
bash setup.sh           # One-line setup if not ready (uninstall: bash setup.sh --uninstall)
```

The setup script handles: dependency install → server auto-start (LaunchAgent) → Chrome extension loading → CLI shortcut (`cp-pilot`).

**macOS TCC restriction:** If server.py is in a protected directory (`~/Documents`, `~/Desktop`), grant Full Disk Access to `/usr/bin/python3` in System Settings → Privacy & Security.

| Symptom | Fix |
|---------|-----|
| `Extension: ✗ Disconnected` | Check `launchctl list \| grep chromepilot` and Chrome extensions page |
| Server exits with code 2 | Grant Full Disk Access to python3 |
| Extension icon is gray | Ensure server is running: `curl http://127.0.0.1:8787/status` |
| "Cannot attach debugger" | Close DevTools on the target tab first |
| Port 8787 in use | `lsof -i :8787` to find and kill the process |

## Core Workflow

1. **Inspect**: `cp tabs` — list browser tabs with IDs
2. **Target**: use `--tab ID` or `--url MATCH` to target a specific tab
3. **Execute**: `cp eval 'expression'` — run JS in page context
4. **Capture**: `cp net start` → interact → `cp net requests` → `cp net body REQ_ID`
5. **Repeat**: browser stays open, session persists between commands

## Agent Response Guidelines

When using ChromePilot capabilities, the agent MUST format responses following these norms. **Never dump raw JSON API responses** — always interpret and present structured results to the user.

### General Principles

- **Verify before reporting**: Check API response `ok` field or command exit code before confirming success to the user. If the response contains an `error` field, report the error with actionable fix.
- **Concise confirmation**: Successful operations → 1-2 sentence summary with key metrics (rule count, tab count, hit count). Not raw JSON.
- **Structured data → markdown tables**: Tab lists, network requests, cookies, proxy hits, storage entries — always render as markdown tables with relevant columns.
- **Files → file:// links**: Screenshots, exported data, saved bodies → save to workspace directory and provide `[View file](file://absolute/path)`.
- **Errors → actionable**: Include the specific error message AND the next step to fix it. Refer to the troubleshooting table above when applicable.
- **Sensitive data → mask**: Cookie values, tokens, session IDs → show `***` by default. Only reveal full values when the user explicitly requests them.
- **Progress narration**: For multi-step operations (proxy setup + reload + verify), briefly narrate each step's result as you go, not just the final outcome.

### Per-Capability Output Format

| Capability | Success Response Format | Key Fields to Present |
|---|---|---|
| `cp tabs` | Markdown table | Tab ID (bold for active), Title, URL (truncated to 60 chars) |
| `cp eval` | Return value in code block; JSON auto-formatted | Value; on error: error message + stack trace |
| `cp net requests` | Markdown table, sorted by time | Method, Path (omit domain), Status, Content-Type |
| `cp net body` | JSON → code block; binary → file link | Content; offer to save large payloads to file |
| Proxy start | `"✓ {mode} proxy started — {n} rules, {m} tabs affected"` | Mode (global/per-tab), rule count, tab count |
| Proxy hit log | Markdown table | Timestamp (relative), URL path, Action taken, Header mods |
| `cp cookie list` | Markdown table | Name, Domain, Value (\*\*\*masked), Secure, HttpOnly, Expires |
| `cp console` | Grouped by level, newest first | Level icon, Timestamp, Message text |
| `cp screenshot` | `[View screenshot](file://path)` + dimensions | File link; save to workspace/output dir, not cwd |
| `cp page` | Key metrics in natural prose | URL, title, readyState, load timing, storage key count |
| `cp storage` | Single value → inline; list → markdown table | Key, Value (JSON formatted if applicable) |

### Output Examples

**Tab listing:**

```
Found 5 open tabs:

| Tab ID | Title | URL |
|--------|-------|-----|
| **12345** | Express Export | expressexport.alibaba.com/shipping/... |
| 12346 | Dashboard | work.alibaba.com/... |
| 12347 | Gmail | mail.google.com/... |

Active tab: **12345**
```

**Proxy confirmation (multi-step narration):**

```
✓ Global proxy started — 2 rules affecting 8 tabs:
  1. expressexport.alibaba.com → redirect to 203.119.204.7 (with setHost)
  2. expressexport.alibaba.com → inject EagleEye-UserData header

Reloading target page...
Hit log shows 12 matches in 5 seconds — proxy is working correctly.
```

**Network capture summary:**

```
Captured 23 requests after page reload:

| # | Method | Path | Status | Type |
|---|--------|------|--------|------|
| 1 | GET | /api/shipping/config | 200 | json |
| 2 | POST | /api/order/detail | 200 | json |
| 3 | GET | /assets/main.js | 304 | javascript |
| ... | | | | |

Want me to inspect a specific request body?
```

**Error with actionable fix:**

```
✗ Cannot attach debugger to tab 12345 — DevTools is already open on that tab.
→ Close the DevTools panel on that tab, then I'll retry.
```

**Cookie listing (masked):**

```
| Name | Domain | Value | Secure | Expires |
|------|--------|-------|--------|---------|
| session_id | .alibaba.com | *** | ✓ | 30 days |
| _tb_token_ | .alibaba.com | *** | ✗ | Session |

Found 2 cookies for .alibaba.com. Need to see full values?
```

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

Key advantage: `eval` runs in the page's MAIN world. `fetch()` calls inherit cookies and auth headers — no token management needed.

### Navigation

```bash
cp navigate https://example.com              # Open in new tab
cp navigate https://example.com --tab 123    # Navigate existing tab
cp navigate https://example.com --wait       # Wait for page load
```

### Network Capture

```bash
cp net start [--tab ID]                      # Start capturing
cp net requests                              # List captured requests
cp net requests --filter "api/v1" --method POST  # Filter
cp net requests --type Fetch --completed     # Only completed Fetch
cp net requests -v                           # Show request IDs (for body)
cp net body REQUEST_ID                       # Get response body
cp net body REQUEST_ID -o resp.json          # Save body to file
cp net clear                                 # Clear buffer
cp net stop                                  # Stop capture
```

### Network Interception

```bash
cp net intercept '[{"urlPattern":"api/users","response":{"status":200,"body":"{\"name\":\"test\"}"}}]'
cp net intercept-stop                        # Stop interception
```

### Console, Cookie, Screenshot, Storage

```bash
cp console start [--tab ID]          # Start console capture
cp console messages [--level error]  # Filter: log, warn, error, info, debug
cp console messages -n 20            # Last 20 messages
cp console clear / stop

cp cookie list [--domain .example.com]                   # List/filter cookies
cp cookie set --url URL --name N --value V [--secure]    # Set cookie
cp cookie delete --url URL --name N                      # Delete cookie

cp screenshot [path/to/output.png]   # Capture screenshot; path should be an absolute path under the agent's workspace or output directory — never save directly to cwd
cp page [--url mysite]               # URL, title, timing, storage key count

cp storage list [--session]          # List localStorage/sessionStorage keys
cp storage get KEY [--session]       # Get value
cp storage set KEY "value"           # Set value
```

## Proxy Rules

Rich request interception with 7 rule types, hit logging, hot-reload, and auto-persistence. Rules survive server restarts via `proxy-rules.json`.

> **Agent must use JSON `rules` array** — `whistleText` is display-only for the popup UI. The extension executes only the `rules` array. Sending `whistleText` without `rules` does nothing.

### Two Proxy Modes

| | Per-tab | Global |
|---|---|---|
| Scope | Single tab | ALL tabs (including new ones) |
| Start | `POST /proxy/start` with `tabId` or `urlMatch` | `POST /proxy/start-global` |
| Stop | `POST /proxy/stop` | `POST /proxy/stop-global` |

Per-tab rules fully replace (not merge with) global rules on that tab.

### How to Start Proxy

**Step 1 — Build `rules` array.** Each rule: `{"pattern": "JS_REGEX", "action": "TYPE", ...fields}`.

**CRITICAL format requirements:**
- `pattern` is JS regex. Escape dots: `"expressexport\\.alibaba\\.com"` (double-escaped in JSON).
- `response.body` must be string: `"{\"key\":\"value\"}"` not `{"key":"value"}`.
- `setHeaders` keys are case-sensitive. `setHost` is required for IP mapping.

**Step 2 — Call HTTP API:**

```bash
# Global proxy (recommended for most scenarios)
curl -X POST http://localhost:8787/proxy/start-global \
  -H "Content-Type: application/json" \
  -d '{"rules": [RULES], "whistleText": "OPTIONAL_DISPLAY_TEXT"}'

# Per-tab proxy
curl -X POST http://localhost:8787/proxy/start \
  -H "Content-Type: application/json" \
  -d '{"tabId": TAB_ID, "rules": [RULES]}'
# Or by URL match:
  -d '{"urlMatch": "URL_SUBSTRING", "rules": [RULES]}'
```

**Step 3 — Verify** with hit log after user interaction:

```bash
curl "http://localhost:8787/proxy/log?limit=10"
```

### Quick Rule Reference

| Action | Purpose | Key Fields | Example Pattern |
|--------|---------|------------|-----------------|
| `mock` | Custom response | `response: {status, body, headers}` | `api/users/me` |
| `block` | Network error | — | `tracking\\.js` |
| `redirect` | Reroute URL (`$1` groups) | `target` | `^https?://old\\.api/(.*)`  |
| `redirect`+`setHost` | IP/host mapping (TLS-safe) | `target`, `setHost` | `^(https?)://api\\.example\\.com(.*)` |
| `header` | Request headers (stackable) | `setHeaders: {}` | `expressexport\\.alibaba\\.com` |
| `resHeader` | Response headers (stackable) | `setHeaders: {}` | `api\\.backend\\.com` |
| `delay` | Latency before forward | `delay` (ms) | `api/slow-endpoint` |
| `disable` | Bypass proxy (highest priority) | — | `cdn\\.safe\\.com` |

Rule evaluation: disable → collect headers → first main action → apply headers → resHeader at response stage.

For complete rule examples, Whistle text format, CORS handling, persistence, and advanced workflows, see [proxy-reference.md](proxy-reference.md).

### Whistle Text — Unified Format

All rules can be written in Whistle text format, both for popup editing and API `whistleText` field. The format is bidirectional — popup editor and API produce the same Whistle text.

```
# Redirect
domain.com http://target.com              # Plain domain redirect (path forwarded)
https://source.com https://target.com     # URL-to-URL redirect
^domain.com/*** http://target/$1          # Regex redirect with path capture
127.0.0.1:6001 domain.com                # IP host mapping (preserve Host & TLS)
host://upstream.host domain1 domain2      # Hostname mapping (multi-domain)

# Headers
domain.com reqHeaders://(Header: Value)   # Request header injection
domain.com resHeaders://(Header: Value)   # Response header modification

# Intercept control
domain.com block://                       # Block request (network error)
domain.com mock://200 {"data":"test"}     # Mock response (status + body)
domain.com delay://2000                   # Add latency (ms)
domain.com disable://                     # Bypass proxy (highest priority)
```

### Alibaba Environment Isolation

The most common proxy use case — inject environment tag headers:

```bash
# Pre-release environment (dpath_env)
curl -X POST http://localhost:8787/proxy/start-global \
  -H "Content-Type: application/json" \
  -d '{
    "rules": [
      {"pattern": "expressexport\\.alibaba\\.com", "action": "header",
       "setHeaders": {"EagleEye-UserData": "dpath_env=YOUR_TAG"}}
    ],
    "whistleText": "expressexport.alibaba.com reqHeaders://(EagleEye-UserData: dpath_env=YOUR_TAG)"
  }'
```

For daily environment: use `scm_project=TAG` instead. For combined IP mapping + headers, see [proxy-reference.md](proxy-reference.md#ip-mapping-with-environment-isolation).

### Managing Proxy

```bash
curl -X POST http://localhost:8787/proxy/update -H "Content-Type: application/json" \
  -d '{"tabId": ID, "rules": [NEW]}'                    # Hot-update
curl "http://localhost:8787/proxy/rules?tabId=ID"        # Query active rules
curl "http://localhost:8787/proxy/log?tabId=ID&limit=50" # Hit log
curl -X POST http://localhost:8787/proxy/stop -H "Content-Type: application/json" \
  -d '{"tabId": ID}'                                     # Stop per-tab
curl -X POST http://localhost:8787/proxy/stop-global     # Stop global
```

## Common Agent Workflows

### Explore an Authenticated Web App

```bash
cp tabs                                    # Find the target tab
cp net start --url myapp                   # Start capturing
cp eval 'location.reload()' --url myapp    # Trigger page load
cp net requests --type Fetch --completed   # See API calls
cp net body REQ_ID                         # Inspect response
cp cookie list --url https://myapp.com     # Check auth cookies
```

### Switch Pre-Release Environment (Alibaba)

```bash
# 1. Start global proxy with IP mapping + header
curl -X POST http://localhost:8787/proxy/start-global \
  -H "Content-Type: application/json" \
  -d '{"rules": [
    {"pattern": "^(https?)://expressexport\\.alibaba\\.com(.*)", "action": "redirect",
     "target": "$1://203.119.204.7$2", "setHost": "expressexport.alibaba.com"},
    {"pattern": "expressexport\\.alibaba\\.com", "action": "header",
     "setHeaders": {"EagleEye-UserData": "dpath_env=coupon-unbind"}}
  ], "whistleText": "203.119.204.7 expressexport.alibaba.com\nexprexport.alibaba.com reqHeaders://(EagleEye-UserData: dpath_env=coupon-unbind)"}'
# 2. Reload and verify
cp tab reload --url expressexport
curl -s "http://localhost:8787/proxy/log?limit=5"
```

### Block Requests & Debug CORS

```bash
# Block analytics site-wide
curl -X POST http://localhost:8787/proxy/start-global -H "Content-Type: application/json" \
  -d '{"rules": [{"pattern": "google-analytics\\.com", "action": "block"}, {"pattern": "hotjar\\.com", "action": "block"}]}'

# Fix CORS (* auto-replaced with actual origin for credentials)
curl -X POST http://localhost:8787/proxy/start-global -H "Content-Type: application/json" \
  -d '{"rules": [{"pattern": "api\\.backend\\.com", "action": "resHeader", "setHeaders": {"Access-Control-Allow-Origin": "*"}}]}'
```

For more workflows (redirect to local dev, simulate slow network, combine rules), see [proxy-reference.md](proxy-reference.md#additional-workflow-examples).

## Global Options

| Option | Description |
|--------|-------------|
| `--tab ID` | Target tab by Chrome tab ID |
| `--url MATCH` | Target tab by URL substring match |
| `--json` | Output raw JSON for programmatic use |
| `--port PORT` | Server port (default: 8787) |

Tab targeting priority: explicit `--tab` > `--url` match > active tab.

## Architecture

```
CLI (cp.py) → HTTP → server.py → WebSocket → Chrome Extension → Chrome APIs
                                                    ↓
                                            MAIN world execution
                                            (page context + cookies)
```

## Tips

- Always `cp tabs` first to see available tabs and their IDs
- Use `--url` for convenience (matches substring), `--tab` for precision
- Network capture requires debugger — close DevTools on the target tab first
- `cp eval` in MAIN world can access any page variable or API
- If commands fail, check `cp status` to verify extension connection
