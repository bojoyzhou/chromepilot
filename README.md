<p align="center">
  <img src="./logo.png" width="128" alt="ChromePilot Logo">
</p>

<h1 align="center">ChromePilot</h1>

<p align="center">
  <a href="./README_CN.md">中文文档</a>
</p>

**An AI Agent's cockpit for real Chrome.**

ChromePilot lets AI Agents execute JavaScript, capture network traffic, intercept API calls, manage cookies, and take screenshots — all inside your **real Chrome browser** using your existing login sessions. No puppet browsers, no token juggling, no CDP flags. Just install a lightweight Chrome extension and go.

```
AI Agent ──HTTP──▸ ChromePilot Server ──WebSocket──▸ Chrome Extension ──▸ Your Browser
                                                          │
                                                     MAIN world execution
                                                 (your cookies, your sessions)
```

## Why ChromePilot?

Every existing browser automation tool faces the same fundamental problem: **they can't use your login sessions.**

| | ChromePilot | browser-use | Playwright / Puppeteer |
|---|---|---|---|
| Uses your real Chrome | Yes (extension) | Requires `--remote-debugging-port` | Launches separate browser |
| Inherits login sessions | Automatic | Needs Chrome Profile config | Not supported |
| `fetch()` sends cookies | Yes (MAIN world) | No (isolated context) | No |
| Network capture | Yes (in-extension CDP) | No | Yes |
| Request interception & mock | Yes | No | Yes |
| Proxy rules (block/redirect/delay/header) | Yes (5 actions) | No | Limited |
| Console capture | Yes | No | Yes |
| Cookie management | Yes (chrome.cookies API) | Via CLI | Via CDP |
| Setup complexity | Install extension | Install binary + config | Install browser + driver |
| Dependencies | Python + aiohttp | Rust binary | Node.js + browser binary |
| Single command latency | ~15ms | ~50ms | ~30ms |

The key difference is architectural. CDP-based tools inject scripts into an **isolated world** — your `fetch("/api/data")` won't carry the page's authentication cookies. ChromePilot's extension uses `chrome.scripting.executeScript` to run code in the **MAIN world**, so your JavaScript behaves exactly as if you typed it in the browser console. Every `fetch` call, every `XMLHttpRequest`, every `document.cookie` access works identically to the real page.

This matters because the most valuable browser automation scenarios involve **authenticated internal tools** — dashboards, admin panels, project management systems, monitoring platforms — where authentication flows are either complex (SSO, MFA, certificate auth) or simply impossible to replicate programmatically. With ChromePilot, if you can see it in Chrome, your Agent can operate on it.

## Quick Start

### One-Line Setup (Recommended)

```bash
bash setup.sh
```

The script automatically: checks dependencies → installs aiohttp → configures server auto-start → guides Chrome extension installation → verifies connection → sets up `cp-pilot` shortcut.

Uninstall: `bash setup.sh --uninstall`

### Manual Setup

#### 1. Build the Chrome Extension

```bash
npm install
npm run build
```

#### 2. Install the Chrome Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` directory
4. You should see "ChromePilot" appear with a green status

#### 3. Start the Server

```bash
pip install aiohttp
python3 server.py
```

```
[chromepilot] ChromePilot Server v2.0.0
[chromepilot] Listening on http://127.0.0.1:8787
[chromepilot] Waiting for Chrome extension to connect...
[chromepilot] ✓ Extension connected
```

#### 4. Start Using It

```bash
python3 cp.py status
#   Extension: ✓ Connected
#   Server:    v2.0.0
#   Port:      8787

python3 cp.py tabs
#   * [887966267] Google - Chrome
#           https://www.google.com
#     [887967344] Internal Dashboard
#           https://internal.company.com/dashboard

python3 cp.py eval 'document.title'
# Google
```

That's it. No config files, no environment variables, no browser binary downloads.

## Extension Development (TS + Vite)

```bash
npm install
npm run dev        # watch mode
npm run typecheck  # TypeScript checks
npm run lint       # ESLint
npm run test       # Vitest
npm run build      # production bundle to extension/
```

Code migration map:

- Legacy extension scripts: `extension/background.js`, `extension/popup.js`
- New build entrypoints: `src/extension/background/index.ts`, `src/extension/popup/main.ts`
- New extension modules: `src/extension/background/modules/`, `src/extension/popup/modules/`

## Real-World Examples

### Extract Data from Authenticated Internal Systems

Your Agent needs to pull data from an internal project dashboard. The user is already logged in via SSO.

```bash
# Find the target tab
cp tabs
#     [42001] Project Dashboard - Acme Corp
#           https://dashboard.internal.com/projects

# fetch() carries cookies automatically — zero extra config
cp eval 'fetch("/api/v1/projects?status=active").then(r => r.json()).then(d => JSON.stringify(d))' --url dashboard
# [{"id":1,"name":"Project Alpha","status":"active","owner":"alice"}, ...]
```

With any CDP-based tool, this `fetch` would return 401 because the request wouldn't carry session cookies. ChromePilot just works.

### Reverse-Engineer an Unfamiliar Web App's API

You've opened a new internal tool and need to figure out which APIs it calls. Instead of reading minified source code, just observe network traffic:

```bash
# Start capturing on the target tab
cp net start --url dashboard

# Trigger some user actions
cp eval 'document.querySelector(".refresh-btn").click()' --url dashboard

# See what APIs were called
cp net requests --type Fetch --completed -v
#   ← POST 200 https://dashboard.internal.com/graphql [2.3KB] application/json
#     requestId: 1001.42
#   ← GET 200 https://dashboard.internal.com/api/metrics?range=7d [890B] application/json
#     requestId: 1001.43

# Inspect the GraphQL request body
cp net body 1001.42
# {
#   "query": "query GetProjects($status: String!) { projects(status: $status) { id name owner } }",
#   "variables": {"status": "active"}
# }

# Now you know the full API contract — reuse it directly
cp eval 'fetch("/graphql", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({
    query: "query GetProjects($status: String!) { projects(status: $status) { id name owner } }",
    variables: {status: "active"}
  })
}).then(r => r.json()).then(d => JSON.stringify(d))' --url dashboard
```

The Agent discovered the API structure purely by observing network traffic — no documentation needed.

### Mock API Responses to Test Edge Cases

You want to see how a page handles error states, but the real API always returns success:

```bash
# Set up interception: mock the pricing API to return an error
cp net intercept '[{
  "urlPattern": "api/pricing",
  "response": {
    "status": 500,
    "headers": {"content-type": "application/json"},
    "body": "{\"error\": \"Service temporarily unavailable\"}"
  }
}]' --url myapp

# Reload — the page hits our mock instead of the real API
cp tab reload --url myapp

# Check if the app displays the error state correctly
cp screenshot error-state.png --url myapp

# Check console for uncaught errors
cp console start --url myapp
cp eval 'document.querySelector(".retry-btn").click()' --url myapp
cp console messages --level error
#   ✗ Uncaught TypeError: Cannot read properties of undefined (reading 'price')
#       at PricingWidget.render (pricing.js:42)

# Clean up
cp net intercept-stop --url myapp
```

You just found a bug — the app doesn't gracefully handle API errors. And you never touched the backend code.

### Monitor Long-Running Processes

You're watching a deployment pipeline in a web UI and want to know when the status changes:

```bash
# Start console + network capture
cp console start --url pipeline
cp net start --url pipeline

# Poll for status changes
while true; do
  status=$(cp eval 'document.querySelector(".pipeline-status")?.textContent' --url pipeline)
  echo "[$(date +%H:%M:%S)] Status: $status"
  
  if [ "$status" = "Success" ] || [ "$status" = "Failed" ]; then
    # Capture final state
    cp screenshot "pipeline-$(date +%Y%m%d-%H%M%S).png" --url pipeline
    cp console messages --level error -n 5
    cp net requests --filter "api/deploy" --completed
    break
  fi
  sleep 10
done
```

### Manage Browser State for Testing

```bash
# See current cookies
cp cookie list --domain .myapp.com
#   🔒H .myapp.com    session_token    eyJhbGciOiJIUz...
#   🔒  .myapp.com    theme            dark
#      .myapp.com    onboarding       completed

# Modify cookies to test different user states
cp cookie set --url https://myapp.com --name onboarding --value pending

# Inspect localStorage
cp storage list --url myapp
#   localStorage: 12 keys
#     user_preferences
#     feature_flags
#     cache_v2

# Read a specific value
cp storage get feature_flags --url myapp
# {"dark_mode": true, "beta_features": false, "new_editor": true}

# Toggle feature flags
cp storage set feature_flags '{"dark_mode":true,"beta_features":true,"new_editor":true}' --url myapp

# Reload and verify
cp tab reload --url myapp
cp screenshot feature-flags-test.png --url myapp
```

### Get Page Performance Metrics

```bash
cp page --url myapp
#   URL:             https://myapp.com/dashboard
#   Title:           Dashboard - MyApp
#   Ready state:     complete
#   Content type:    text/html
#   Cookies:         15
#   localStorage:    12 keys
#   sessionStorage:  3 keys
#   DOMContentLoaded: 847ms
#   Load:            1203ms
```

### Proxy Rules — Mock, Block, Redirect, Delay, Modify Headers

ChromePilot's proxy system lets you apply rich rules to intercept requests on any tab. Five actions are supported: `mock` (return custom response), `block` (fail the request), `redirect` (reroute to another URL), `delay` (add latency), and `header` (add/remove/modify request headers).

```bash
# Start proxy with multiple rules
cp proxy start '[
  {"pattern": "api/billing", "action": "mock", "response": {"status": 200, "body": {"plan": "enterprise"}}},
  {"pattern": "tracking\\.js",  "action": "block"},
  {"pattern": "cdn\\.old\\.com", "action": "redirect", "target": "https://cdn.new.com"},
  {"pattern": "slow-api",       "action": "delay", "delay": 3000},
  {"pattern": "api/config",     "action": "header", "setHeaders": {"X-Debug": "true"}, "removeHeaders": ["Cache-Control"]}
]' --url myapp

# Watch what gets intercepted
cp proxy log --url myapp
#   📦 GET  https://myapp.com/api/billing          mock 200
#   🚫 GET  https://myapp.com/tracking.js           blocked
#   ↪ GET  https://cdn.old.com/bundle.js            → https://cdn.new.com/bundle.js
#   ⏱ POST https://myapp.com/slow-api              3000ms
#   📝 GET  https://myapp.com/api/config            headers: +1 -1

# Hot-update rules without restarting
cp proxy update '[{"pattern": "api/billing", "action": "mock", "response": {"status": 403, "body": {"error": "forbidden"}}}]' --url myapp

# Check current rules
cp proxy list --url myapp

# Stop proxy
cp proxy stop --url myapp
```

Unlike the lower-level `cp net intercept` (which only supports mock responses), the proxy system offers five distinct actions, hit logging, hot-reload of rules, and works alongside network capture without interference.

### Global Proxy Mode

Global proxy automatically applies rules to **all browser tabs** — including new tabs opened after proxy start. No need to specify `--tab` or `--url`. Rules persist across server/extension restarts.

```bash
# Start global proxy via HTTP API
curl -X POST http://localhost:8787/proxy/start-global \
  -H "Content-Type: application/json" \
  -d '{"rules": [{"pattern": "tracking\\.js", "action": "block"}]}'

# Stop global proxy
curl -X POST http://localhost:8787/proxy/stop-global
```

You can also manage global proxy directly from the **Popup UI** (click the ChromePilot extension icon) using Whistle-compatible text format — no JSON needed.

### Whistle-Compatible Rule Format

The Popup UI accepts rules in [Whistle](https://github.com/nicedoc/whistle) text format for easy editing. One rule per line:

```
# Redirect CDN
^s.alicdn.com/@g/*** http://dev.g.alicdn.com/$1

# URL redirect
https://example.com https://staging.example.com

# IP host mapping (resolves domain to specified IP, preserving Host header & TLS SNI)
140.205.215.168 api.example.com

# Add custom request headers to matching requests
*.example.com reqHeaders://(X-Debug: true)
*.internal.com reqHeaders://(EagleEye-UserData: dpath_env=12345)

# Comments start with #
# Commented-out rules are ignored
```

Supported formats: `^domain/*** target/$1` (regex redirect), `https://src https://dst` (URL redirect), `IP domain` (IP host mapping), `pattern reqHeaders://(Header: Value)` (request header modifier). Header modifiers can be combined with other rules — they act as overlays applied to all matching requests.

### IP Host Mapping with Correct TLS

When using `IP domain` rules, ChromePilot proxies the request through the server with a custom DNS resolver. This ensures the TLS handshake uses the correct SNI (Server Name Indication) — the domain name, not the IP — so HTTPS connections work properly. The original Host header is preserved.

### Popup UI

Click the ChromePilot extension icon to open the management panel. The popup provides:

- **Overview tab** — connection status, active features across all tabs, statistics
- **Proxy tab** — start/stop global proxy, edit rules in Whistle text format, view hit log in real-time

Rules edited in the popup are automatically persisted and synced with the server.

## Command Reference

### Global Options

```
--port PORT     Server port (default: 8787)
--json          Output raw JSON for programmatic use
```

Tab targeting (supported by most commands):

```
--tab ID        Target by Chrome tab ID
--url MATCH     Target by URL substring match
(omitted)       Uses the currently active tab
```

### Commands

```bash
# Connection
cp status                                    # Check server + extension status

# Tabs
cp tabs                                      # List all tabs with IDs
cp tab create [URL]                          # Open new tab
cp tab close TAB_ID                          # Close tab
cp tab reload [--tab ID] [--no-cache]        # Reload tab
cp tab activate TAB_ID                       # Bring tab to foreground

# JavaScript Execution
cp eval 'expression'                         # Execute JS in MAIN world (page context)
cp eval -f script.js [--url match]           # Execute JS file
cp eval 'expr' --isolated                    # Execute in ISOLATED world

# Navigation
cp navigate URL [--tab ID] [--wait]          # Navigate to URL (--wait for load)

# Network Capture
cp net start [--tab ID]                      # Start capturing
cp net requests [--filter PAT] [--method M]  # View captured requests
cp net requests --type Fetch --completed -v  # Filter + show request IDs
cp net body REQUEST_ID [-o file.json]        # Get response body
cp net clear                                 # Clear buffer
cp net stop                                  # Stop capturing

# Network Interception
cp net intercept 'RULES_JSON' [--tab ID]     # Set mock rules
cp net intercept-stop                        # Remove all rules

# Console Capture
cp console start [--tab ID]                  # Start capturing
cp console messages [--level error] [-n 20]  # View messages
cp console clear                             # Clear buffer
cp console stop                              # Stop capturing

# Cookies
cp cookie list [--domain D] [--url U]        # List cookies
cp cookie set --url U --name N --value V     # Set cookie
cp cookie delete --url U --name N            # Delete cookie

# Screenshot
cp screenshot [output.png] [--format jpeg]   # Capture visible area

# Page Info
cp page [--tab ID]                           # URL, title, load times, storage stats

# Proxy Rules (mock / block / redirect / delay / header)
cp proxy start 'RULES_JSON' [--tab ID]       # Start proxy with rules
cp proxy start -f rules.json [--tab ID]      # Load rules from file
cp proxy list [--tab ID]                     # Show active rules
cp proxy log [--tab ID] [-n 20]              # View intercepted requests
cp proxy update 'RULES_JSON'                 # Hot-update rules
cp proxy clear-log                           # Clear hit log
cp proxy stop                                # Stop proxy

# Storage
cp storage list [--session]                  # List localStorage/sessionStorage keys
cp storage get KEY                           # Get value (JSON auto-formatted)
cp storage set KEY VALUE                     # Set value
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Chrome Browser                   │
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                │
│  │  Tab 1   │  │  Tab 2   │  │  Tab 3   │   ...         │
│  │ (logged  │  │ (logged  │  │ (any    │               │
│  │  in via  │  │  in via  │  │  page)   │               │
│  │  SSO)    │  │  OAuth)  │  │          │               │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│  ┌────┴──────────────┴──────────────┴────────────────┐  │
│  │           ChromePilot Extension (MV3)              │  │
│  │                                                    │  │
│  │  chrome.scripting.executeScript (MAIN world)       │  │
│  │  chrome.debugger (Network/Fetch/Runtime)           │  │
│  │  chrome.cookies                                    │  │
│  │  chrome.tabs                                       │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │ WebSocket                      │
└─────────────────────────┼───────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │   ChromePilot Server  │
              │   (Python/aiohttp)    │
              │                       │
              │   HTTP REST API       │
              │   WebSocket relay     │
              │   SSE event stream    │
              └───────────┬───────────┘
                          │ HTTP
              ┌───────────┴───────────┐
              │   CLI (cp.py)         │
              │   or any HTTP client  │
              │   or your AI Agent    │
              └───────────────────────┘
```

**Why this architecture?**

The Chrome extension approach solves what CDP cannot:

1. **MAIN world execution** — `chrome.scripting.executeScript({world: "MAIN"})` runs your code in the page's own JavaScript context. Variables, cookies, fetch interceptors — everything is shared with the page. CDP's `Runtime.evaluate` runs in an isolated context by default.

2. **Zero-config authentication** — The extension naturally inherits the user's existing login sessions. SSO, OAuth, certificate auth, MFA — if the user is logged in, the Agent is logged in. No need to replay authentication flows.

3. **No browser restart required** — CDP requires Chrome to be launched with `--remote-debugging-port`. ChromePilot works on any running Chrome instance — just install the extension.

4. **Debugger API access** — The extension can use `chrome.debugger` to attach DevTools Protocol to individual tabs, enabling network capture and request interception without Chrome-level CDP access.

## Integration

### As an Agent Skill

ChromePilot ships with an Agent Skill definition file that teaches AI Agents how to use each command.

Compatible with: **QoderWork** / **Cursor** / **Claude Code** / **Qoder** / **Codex**

### As an HTTP API

The server exposes a clean REST API that any HTTP client can call:

```bash
# List tabs
curl http://localhost:8787/tabs

# Execute JS
curl -X POST http://localhost:8787/evaluate \
  -H "Content-Type: application/json" \
  -d '{"expression": "document.title", "urlMatch": "myapp"}'

# Start network capture
curl -X POST http://localhost:8787/network/start \
  -d '{"urlMatch": "myapp"}'

# Get captured requests
curl "http://localhost:8787/network/requests?tabId=42001&urlPattern=api&completed=true"

# Real-time event stream (SSE)
curl http://localhost:8787/events?types=net,console
```

### Real-Time Event Stream

The `/events` endpoint provides Server-Sent Events for real-time monitoring:

```bash
curl -N http://localhost:8787/events?types=net.request,console

data: {"type":"net.request","tabId":42001,"data":{"url":"https://api.example.com/data","method":"GET","type":"Fetch"}}
data: {"type":"console","tabId":42001,"data":{"level":"log","args":["API response received"]}}
data: {"type":"net.response","tabId":42001,"data":{"url":"https://api.example.com/data","status":200,"mimeType":"application/json"}}
```

## Requirements

- **Chrome** (any recent version) with the ChromePilot extension loaded
- **Python 3.8+** with `aiohttp` (`pip install aiohttp`)
- That's it. No Chromium download, no Node.js, no Selenium, no WebDriver.

## FAQ

**Q: Will I see a "Chrome is being controlled by automated test software" banner?**
A: No. That banner is triggered by CDP/DevTools protocol connections. ChromePilot uses a standard Chrome extension — no automation banner, no detection by anti-bot systems.

**Q: What about the debugger banner?**
A: When you use `cp net start` or `cp console start`, Chrome shows an "Started debugging this browser" info bar on the affected tab. This is expected — it means the `chrome.debugger` API has attached to that tab for network/console capture. It disappears when you run `cp net stop` / `cp console stop`.

**Q: Can I use it with headless Chrome?**
A: ChromePilot is designed for headed Chrome with existing user sessions. If you need headless automation without login state, use Playwright or Puppeteer — they're better suited for that use case.

**Q: How about security?**
A: The server listens on localhost only by default. The extension only connects to `127.0.0.1:8787`. No data leaves your machine unless your scripts explicitly send it out.

## License

MIT
