---
name: chromepilot
description: Pilots AI agents through the user's real Chrome browser via a lightweight extension. Runs JS in page context with full login session, captures network traffic, manages cookies, intercepts requests, and applies rich proxy rules (mock/block/redirect/delay/header). Use when the agent needs to interact with authenticated web pages, inspect API calls, explore web app behavior, or automate browser tasks that require the user's session.
---

# ChromePilot — AI Agent's Chrome Pilot

Execute JS in the user's actual Chrome browser with full page context (login session, cookies, localStorage). Unlike CDP-based tools, ChromePilot uses a Chrome Extension that runs in the MAIN world — fetch calls inherit the page's auth automatically.

## Prerequisites

```bash
cp doctor    # Check server + extension status (or: cp status)
```

Setup: install the Chrome extension from `extension/` directory (developer mode), then start the server:
```bash
python3 server.py          # Keep running in background
```

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

### Proxy Rules (mock / block / redirect / delay / header)

Rich request interception with 5 actions, hit logging, and hot-reload:

```bash
# Start proxy with rules
cp proxy start '[{"pattern":"api/data","action":"mock","response":{"status":200,"body":"{\"ok\":true}"}}]' --url myapp
cp proxy start -f rules.json --url myapp    # Load from file

# View and manage
cp proxy list --url myapp                   # Show active rules
cp proxy log --url myapp                    # View hit log
cp proxy update '[NEW_RULES]' --url myapp   # Hot-update rules
cp proxy clear-log --url myapp              # Clear hit log
cp proxy stop --url myapp                   # Stop proxy
```

Rule format: `[{"pattern": "regex", "action": "mock|block|redirect|delay|header", ...}]`

Actions:
- `mock` — return custom response: `{"action":"mock","response":{"status":200,"body":"...","headers":{}}}`
- `block` — fail the request: `{"action":"block"}`
- `redirect` — reroute to another URL: `{"action":"redirect","target":"https://..."}`
- `delay` — add latency before forwarding: `{"action":"delay","delay":2000}`
- `header` — modify request headers: `{"action":"header","setHeaders":{"X-Debug":"1"},"removeHeaders":["Cache-Control"]}`

Unmatched requests pass through normally. Proxy and `cp net start` can run simultaneously on the same tab.

### Global Proxy Mode

Global proxy applies rules to **all tabs** automatically, including newly opened ones. Rules persist across restarts.

```bash
# Start global proxy via HTTP API
curl -X POST http://localhost:8787/proxy/start-global \
  -H "Content-Type: application/json" \
  -d '{"rules": [{"pattern": "tracking\\.js", "action": "block"}]}'

# Stop global proxy
curl -X POST http://localhost:8787/proxy/stop-global
```

### Whistle-Compatible Rule Format (Popup UI)

The extension popup (click icon) accepts Whistle text format:

```
^cdn.example.com/@g/*** http://dev.cdn.com/$1       # Regex redirect with capture
https://prod.example.com https://staging.example.com  # URL redirect
140.205.215.168 api.example.com                       # IP host mapping (correct TLS SNI)
*.example.com reqHeaders://(X-Debug: true)            # Add request headers
```

IP host mapping routes through the server with custom DNS resolver to preserve correct TLS SNI. Header modifiers (`reqHeaders://`) act as overlays — they combine with other matching rules.

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

- **"Extension not connected"**: Open Chrome with the ChromePilot extension installed
- **"Cannot attach debugger"**: Close DevTools on the target tab (only one debugger at a time)
- **Network body unavailable**: Must call `cp net body` while capture is still active
- **Server won't start**: Check if port 8787 is already in use (`lsof -i :8787`)
