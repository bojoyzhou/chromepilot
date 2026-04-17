#!/usr/bin/env python3
"""
cp — ChromePilot CLI

Pilot your real Chrome browser from the command line via a lightweight extension.
Unlike CDP-based tools, cp runs JS in the actual page context (MAIN world),
inheriting the page's login session and cookies automatically.

Usage:
  cp status                              Check extension connection
  cp tabs                                List all browser tabs

  cp tab create [URL]                    Create new tab
  cp tab close TAB_ID                    Close tab
  cp tab reload [--tab ID]               Reload tab
  cp tab activate TAB_ID                 Activate tab

  cp eval 'expression' [--tab ID]        Execute JS in page context
  cp eval -f script.js [--url match]     Execute JS file
  cp navigate URL [--tab ID]             Navigate to URL

  cp net start [--tab ID]                Start network capture
  cp net stop [--tab ID]                 Stop capture
  cp net requests [--filter PAT]         Show captured requests
  cp net body REQUEST_ID [--tab ID]      Get response body
  cp net clear [--tab ID]                Clear captured data
  cp net intercept [--tab ID] RULES_JSON Set intercept rules
  cp net intercept-stop [--tab ID]       Stop interception

  cp console start [--tab ID]            Start console capture
  cp console stop [--tab ID]             Stop capture
  cp console messages [--level LEVEL]    Show captured messages
  cp console clear [--tab ID]            Clear buffer

  cp cookie list [--domain D]            List cookies
  cp cookie set --url U --name N --value V  Set cookie
  cp cookie delete --url U --name N      Delete cookie

  cp screenshot [--tab ID] [FILE]        Capture screenshot
  cp page [--tab ID]                     Get page info

  cp storage list [--tab ID]             List localStorage keys
  cp storage get KEY [--tab ID]          Get value
  cp storage set KEY VALUE [--tab ID]    Set value
"""

import argparse
import base64
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

DEFAULT_PORT = 8787


# ── HTTP Client ───────────────────────────────────────────────
def api_get(path, port=DEFAULT_PORT, params=None, timeout=30):
    url = f"http://127.0.0.1:{port}{path}"
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
        if qs:
            url += f"?{qs}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.URLError as e:
        return _handle_error(e)


def api_post(path, port=DEFAULT_PORT, data=None, timeout=30):
    url = f"http://127.0.0.1:{port}{path}"
    req = urllib.request.Request(url, method="POST")
    req.add_header("Content-Type", "application/json")
    body = json.dumps(data or {}).encode()
    try:
        with urllib.request.urlopen(req, body, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.URLError as e:
        return _handle_error(e)


def api_delete(path, port=DEFAULT_PORT, data=None, timeout=30):
    url = f"http://127.0.0.1:{port}{path}"
    req = urllib.request.Request(url, method="DELETE")
    req.add_header("Content-Type", "application/json")
    body = json.dumps(data or {}).encode()
    try:
        with urllib.request.urlopen(req, body, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.URLError as e:
        return _handle_error(e)


def _handle_error(e):
    if hasattr(e, "read"):
        try:
            return json.loads(e.read())
        except Exception:
            pass
    print(f"Error: {e}", file=sys.stderr)
    print("Is the bridge server running? Start with: python3 server.py", file=sys.stderr)
    sys.exit(1)


# ── Output Helpers ────────────────────────────────────────────
def _json_out(data):
    """Print JSON to stdout."""
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _check_error(result):
    """Check for errors and exit if found."""
    if isinstance(result, dict) and "error" in result:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


def _tab_target(args):
    """Build tab targeting params from args."""
    params = {}
    if getattr(args, "tab", None):
        params["tabId"] = args.tab
    if getattr(args, "url", None):
        params["urlMatch"] = args.url
    return params


# ── Commands: Status ──────────────────────────────────────────
def cmd_status(args):
    result = api_get("/status", args.port)
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        status = "✓ Connected" if result.get("connected") else "✗ Disconnected"
        print(f"  Extension: {status}")
        print(f"  Server:    v{result.get('version', '?')}")
        print(f"  Port:      {args.port}")


# ── Commands: Tabs ────────────────────────────────────────────
def cmd_tabs(args):
    result = api_get("/tabs", args.port)
    _check_error(result)
    if args.json:
        _json_out(result)
        return
    tabs = result if isinstance(result, list) else result.get("data", [])
    for t in tabs:
        active = " *" if t.get("active") else "  "
        title = (t.get("title") or "")[:55]
        print(f" {active}[{t['tabId']}] {title}")
        print(f"          {(t.get('url') or '')[:85]}")


def cmd_tab_create(args):
    result = api_post("/tab/create", args.port, {"url": args.url or "about:blank"})
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Created tab {result.get('tabId')}: {result.get('url', '')}")


def cmd_tab_close(args):
    result = api_post("/tab/close", args.port, {"tabId": args.tab_id})
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Closed tab {args.tab_id}")


def cmd_tab_reload(args):
    result = api_post("/tab/reload", args.port, {
        **_tab_target(args),
        "bypassCache": args.no_cache,
    })
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Reloaded tab {result.get('tabId', '?')}")


def cmd_tab_activate(args):
    result = api_post("/tab/activate", args.port, {"tabId": args.tab_id})
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Activated tab {args.tab_id}")


# ── Commands: Eval & Navigate ─────────────────────────────────
def cmd_eval(args):
    if args.file:
        expr = Path(args.file).read_text(encoding="utf-8")
    else:
        expr = args.expression
    if not expr:
        print("Error: provide an expression or use -f FILE", file=sys.stderr)
        sys.exit(1)

    payload = {
        "expression": expr,
        **_tab_target(args),
    }
    if args.isolated:
        payload["world"] = "ISOLATED"
    timeout = args.timeout or 30
    payload["timeout"] = timeout

    result = api_post("/evaluate", args.port, payload, timeout=timeout + 5)
    _check_error(result)

    if args.json:
        _json_out(result)
    else:
        val = result.get("result")
        if isinstance(val, str):
            print(val)
        elif val is not None:
            print(json.dumps(val, ensure_ascii=False, indent=2))


def cmd_navigate(args):
    payload = {
        "url": args.url,
        "waitForLoad": args.wait,
    }
    if args.tab:
        payload["tabId"] = args.tab
    result = api_post("/navigate", args.port, payload, timeout=60)
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Navigated → tab {result.get('tabId', '?')}")


# ── Commands: Network ─────────────────────────────────────────
def cmd_net_start(args):
    result = api_post("/network/start", args.port, _tab_target(args))
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Network capture started on tab {result.get('tabId', '?')}")


def cmd_net_stop(args):
    result = api_post("/network/stop", args.port, _tab_target(args))
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Stopped. Captured {result.get('count', 0)} requests.")


def cmd_net_requests(args):
    params = {}
    if args.tab:
        params["tabId"] = args.tab
    if args.filter:
        params["urlPattern"] = args.filter
    if args.method:
        params["method"] = args.method
    if args.type:
        params["type"] = args.type
    if args.limit:
        params["limit"] = args.limit
    if args.completed:
        params["completed"] = "true"

    result = api_get("/network/requests", args.port, params)
    _check_error(result)

    if args.json:
        _json_out(result)
        return

    reqs = result.get("data", [])
    if not reqs:
        print("  No captured requests.")
        return

    print(f"  {result.get('total', len(reqs))} request(s):\n")
    for r in reqs:
        status = r.get("statusCode", "...")
        method = r.get("method", "?")
        url = r.get("url", "")
        size = r.get("size")
        size_str = f" [{_fmt_size(size)}]" if size else ""
        mime = r.get("mimeType", "")
        err = r.get("error")

        if err:
            print(f"  ✗ {method} {status} {url[:100]}{size_str} (error: {err})")
        else:
            print(f"  {'→' if status == '...' else '←'} {method} {status} {url[:100]}{size_str} {mime}")

        if args.verbose and r.get("requestId"):
            print(f"    requestId: {r['requestId']}")


def cmd_net_body(args):
    payload = {"requestId": args.request_id, **_tab_target(args)}
    result = api_post("/network/body", args.port, payload, timeout=15)
    _check_error(result)

    if args.json:
        _json_out(result)
        return

    body = result.get("body", "")
    is_b64 = result.get("base64Encoded", False)

    if args.output:
        data = base64.b64decode(body) if is_b64 else body.encode()
        Path(args.output).write_bytes(data)
        print(f"  Saved to {args.output} ({len(data)} bytes)")
    elif is_b64:
        print(f"  [Binary data, {len(body)} chars base64. Use -o FILE to save.]")
    else:
        # Try to pretty-print JSON
        try:
            parsed = json.loads(body)
            print(json.dumps(parsed, ensure_ascii=False, indent=2))
        except (json.JSONDecodeError, TypeError):
            print(body[:5000])
            if len(body) > 5000:
                print(f"\n  ... truncated ({len(body)} chars total)")


def cmd_net_clear(args):
    result = api_post("/network/clear", args.port, _tab_target(args))
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print("  Buffer cleared.")


def cmd_net_intercept(args):
    try:
        rules = json.loads(args.rules)
    except json.JSONDecodeError as e:
        print(f"Error: invalid JSON rules: {e}", file=sys.stderr)
        sys.exit(1)

    if isinstance(rules, dict):
        rules = [rules]

    payload = {"rules": rules, **_tab_target(args)}
    result = api_post("/network/intercept", args.port, payload)
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Intercept active on tab {result.get('tabId', '?')}, {result.get('ruleCount', 0)} rule(s)")


def cmd_net_intercept_stop(args):
    result = api_post("/network/intercept/stop", args.port, _tab_target(args))
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print("  Interception stopped.")


# ── Commands: Console ─────────────────────────────────────────
def cmd_console_start(args):
    result = api_post("/console/start", args.port, _tab_target(args))
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Console capture started on tab {result.get('tabId', '?')}")


def cmd_console_stop(args):
    result = api_post("/console/stop", args.port, _tab_target(args))
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Stopped. Captured {result.get('count', 0)} messages.")


def cmd_console_messages(args):
    params = {}
    if args.tab:
        params["tabId"] = args.tab
    if args.level:
        params["level"] = args.level
    if args.limit:
        params["limit"] = args.limit

    result = api_get("/console/messages", args.port, params)
    _check_error(result)

    if args.json:
        _json_out(result)
        return

    msgs = result.get("data", [])
    if not msgs:
        print("  No console messages.")
        return

    LEVEL_ICONS = {"log": "  ", "info": "ℹ ", "warn": "⚠ ", "error": "✗ ", "debug": "🔍", "exception": "💥"}
    for m in msgs:
        icon = LEVEL_ICONS.get(m.get("level", ""), "  ")
        args_str = " ".join(str(a) for a in m.get("args", [m.get("text", "")]))
        print(f"  {icon} {args_str[:200]}")


def cmd_console_clear(args):
    result = api_post("/console/clear", args.port, _tab_target(args))
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print("  Buffer cleared.")


# ── Commands: Cookies ─────────────────────────────────────────
def cmd_cookie_list(args):
    params = {}
    if args.domain:
        params["domain"] = args.domain
    if args.cookie_url:
        params["url"] = args.cookie_url
    if args.name:
        params["name"] = args.name

    result = api_get("/cookies", args.port, params)
    _check_error(result)

    if args.json:
        _json_out(result)
        return

    cookies = result.get("data", [])
    if not cookies:
        print("  No cookies found.")
        return

    print(f"  {len(cookies)} cookie(s):\n")
    for c in cookies:
        secure = "🔒" if c.get("secure") else "  "
        http = "H" if c.get("httpOnly") else " "
        value = (c.get("value") or "")[:50]
        print(f"  {secure}{http} {c.get('domain',''):<30} {c.get('name',''):<25} {value}")


def cmd_cookie_set(args):
    payload = {
        "url": args.cookie_url,
        "name": args.name,
        "value": args.value,
    }
    if args.domain:
        payload["domain"] = args.domain
    if args.path:
        payload["path"] = args.path
    if args.secure:
        payload["secure"] = True
    if args.httponly:
        payload["httpOnly"] = True

    result = api_post("/cookies", args.port, payload)
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Cookie set: {args.name}")


def cmd_cookie_delete(args):
    result = api_delete("/cookies", args.port, {"url": args.cookie_url, "name": args.name})
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Cookie deleted: {args.name}")


# ── Commands: Screenshot ──────────────────────────────────────
def cmd_screenshot(args):
    payload = _tab_target(args)
    if args.format:
        payload["format"] = args.format

    result = api_post("/screenshot", args.port, payload)
    _check_error(result)

    data_url = result.get("dataUrl", "")
    if not data_url:
        print("Error: no screenshot data", file=sys.stderr)
        sys.exit(1)

    # Extract base64 data
    if "," in data_url:
        b64_data = data_url.split(",", 1)[1]
    else:
        b64_data = data_url

    img_data = base64.b64decode(b64_data)
    output = args.output or "screenshot.png"
    Path(output).write_bytes(img_data)
    print(f"  Screenshot saved: {output} ({len(img_data)} bytes)")


# ── Commands: Page Info ───────────────────────────────────────
def cmd_page(args):
    params = {}
    if args.tab:
        params["tabId"] = args.tab
    if args.url:
        params["urlMatch"] = args.url

    result = api_get("/page/info", args.port, params)
    _check_error(result)

    if args.json:
        _json_out(result)
        return

    info = result.get("data", {})
    print(f"  URL:            {info.get('url', '?')}")
    print(f"  Title:          {info.get('title', '?')}")
    print(f"  Ready State:    {info.get('readyState', '?')}")
    print(f"  Content Type:   {info.get('contentType', '?')}")
    print(f"  Cookies:        {info.get('cookies', 0)}")
    print(f"  localStorage:   {info.get('localStorage', 0)} keys")
    print(f"  sessionStorage: {info.get('sessionStorage', 0)} keys")
    perf = info.get("performance", {})
    if perf:
        print(f"  DOMContentLoaded: {perf.get('domContentLoaded', '?')}ms")
        print(f"  Load:           {perf.get('load', '?')}ms")


# ── Commands: Proxy ────────────────────────────────────────────
def _parse_proxy_rules(args):
    """Parse proxy rules from inline JSON or file."""
    raw = None
    if getattr(args, "file", None):
        raw = Path(args.file).read_text(encoding="utf-8")
    elif getattr(args, "rules", None):
        raw = args.rules
    if not raw:
        print("Error: provide rules JSON or use -f FILE", file=sys.stderr)
        sys.exit(1)
    try:
        rules = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Error: invalid JSON: {e}", file=sys.stderr)
        sys.exit(1)
    if isinstance(rules, dict):
        rules = [rules]
    return rules


def cmd_proxy_start(args):
    rules = _parse_proxy_rules(args)
    payload = {"rules": rules, **_tab_target(args)}
    result = api_post("/proxy/start", args.port, payload)
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Proxy active on tab {result.get('tabId', '?')}, {result.get('ruleCount', 0)} rule(s)")
        for i, r in enumerate(rules):
            action = r.get("action", "mock")
            pat = r.get("pattern", "?")
            ACTION_ICONS = {"mock": "📦", "block": "🚫", "redirect": "↪", "delay": "⏱", "header": "📝"}
            icon = ACTION_ICONS.get(action, "•")
            detail = ""
            if action == "mock":
                detail = f" → {r.get('response', r).get('status', 200)}"
            elif action == "redirect":
                detail = f" → {r.get('target', '?')}"
            elif action == "delay":
                detail = f" {r.get('delay', 1000)}ms"
            elif action == "block":
                detail = ""
            elif action == "header":
                h = r.get("setHeaders", {})
                detail = f" +{len(h)} headers"
            print(f"    {icon} {action:<8} /{pat}/{detail}")


def cmd_proxy_stop(args):
    result = api_post("/proxy/stop", args.port, _tab_target(args))
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Proxy stopped. {result.get('logCount', 0)} requests were intercepted.")


def cmd_proxy_update(args):
    rules = _parse_proxy_rules(args)
    payload = {"rules": rules, **_tab_target(args)}
    result = api_post("/proxy/update", args.port, payload)
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Rules updated: {result.get('ruleCount', 0)} rule(s)")


def cmd_proxy_list(args):
    params = {}
    if args.tab:
        params["tabId"] = args.tab
    if args.url:
        params["urlMatch"] = args.url
    result = api_get("/proxy/rules", args.port, params)
    _check_error(result)
    if args.json:
        _json_out(result)
        return
    if not result.get("active"):
        print("  Proxy not active on this tab.")
        return
    rules = result.get("data", [])
    print(f"  Proxy active on tab {result.get('tabId', '?')}, {len(rules)} rule(s):\n")
    ACTION_ICONS = {"mock": "📦", "block": "🚫", "redirect": "↪", "delay": "⏱", "header": "📝"}
    for i, r in enumerate(rules):
        action = r.get("action", "mock")
        icon = ACTION_ICONS.get(action, "•")
        print(f"  {i+1}. {icon} {action:<8} /{r.get('pattern', '?')}/")


def cmd_proxy_log(args):
    params = {}
    if args.tab:
        params["tabId"] = args.tab
    if args.url:
        params["urlMatch"] = args.url
    if args.limit:
        params["limit"] = args.limit
    result = api_get("/proxy/log", args.port, params)
    _check_error(result)
    if args.json:
        _json_out(result)
        return
    entries = result.get("data", [])
    total = result.get("total", len(entries))
    if not entries:
        print("  No proxy hits yet.")
        return
    print(f"  {total} hit(s):\n")
    ACTION_ICONS = {"mock": "📦", "block": "🚫", "redirect": "↪", "delay": "⏱", "header": "📝"}
    for e in entries:
        icon = ACTION_ICONS.get(e.get("action", ""), "•")
        method = e.get("method", "?")
        url_short = (e.get("url", ""))[:80]
        detail = e.get("detail", "")
        print(f"  {icon} {method:<4} {url_short}")
        if detail:
            print(f"         {detail}")


def cmd_proxy_clear_log(args):
    result = api_post("/proxy/clear-log", args.port, _tab_target(args))
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print("  Proxy log cleared.")


# ── Commands: Storage ─────────────────────────────────────────
def cmd_storage_list(args):
    store = "sessionStorage" if args.session else "localStorage"
    expr = f"JSON.stringify(Object.keys({store}))"
    result = api_post("/evaluate", args.port, {
        "expression": expr,
        **_tab_target(args),
    })
    _check_error(result)

    if args.json:
        _json_out(result)
        return

    try:
        keys = json.loads(result.get("result", "[]"))
    except (json.JSONDecodeError, TypeError):
        keys = []

    if not keys:
        print(f"  {store} is empty.")
        return

    print(f"  {store}: {len(keys)} key(s)\n")
    for k in keys:
        print(f"    {k}")


def cmd_storage_get(args):
    store = "sessionStorage" if args.session else "localStorage"
    key_escaped = args.key.replace("'", "\\'")
    expr = f"{store}.getItem('{key_escaped}')"
    result = api_post("/evaluate", args.port, {
        "expression": expr,
        **_tab_target(args),
    })
    _check_error(result)

    if args.json:
        _json_out(result)
        return

    val = result.get("result")
    if val is None:
        print(f"  Key '{args.key}' not found in {store}.")
    else:
        # Try to pretty-print JSON
        try:
            parsed = json.loads(val)
            print(json.dumps(parsed, ensure_ascii=False, indent=2))
        except (json.JSONDecodeError, TypeError):
            print(val)


def cmd_storage_set(args):
    store = "sessionStorage" if args.session else "localStorage"
    key_escaped = args.key.replace("'", "\\'")
    val_escaped = args.value.replace("'", "\\'")
    expr = f"{store}.setItem('{key_escaped}', '{val_escaped}')"
    result = api_post("/evaluate", args.port, {
        "expression": expr,
        **_tab_target(args),
    })
    _check_error(result)
    if args.json:
        _json_out(result)
    else:
        print(f"  Set {store}['{args.key}']")


# ── Utilities ─────────────────────────────────────────────────
def _fmt_size(n):
    if n is None:
        return "?"
    if n < 1024:
        return f"{n}B"
    if n < 1024 * 1024:
        return f"{n/1024:.1f}KB"
    return f"{n/1024/1024:.1f}MB"


# ── CLI Parser ────────────────────────────────────────────────
def build_parser():
    parser = argparse.ArgumentParser(
        prog="cp",
        description="ChromePilot — CLI for AI agents to pilot Chrome via extension",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Bridge server port")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")

    sub = parser.add_subparsers(dest="command", metavar="COMMAND")

    # status
    sub.add_parser("status", help="Check extension connection")

    # tabs
    sub.add_parser("tabs", help="List all browser tabs")

    # tab
    p_tab = sub.add_parser("tab", help="Tab management")
    tab_sub = p_tab.add_subparsers(dest="tab_action", metavar="ACTION")

    p_tc = tab_sub.add_parser("create", help="Create new tab")
    p_tc.add_argument("url", nargs="?", help="URL to open")

    p_tx = tab_sub.add_parser("close", help="Close tab")
    p_tx.add_argument("tab_id", type=int, help="Tab ID")

    p_tr = tab_sub.add_parser("reload", help="Reload tab")
    p_tr.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_tr.add_argument("--url", "-u", help="Match by URL")
    p_tr.add_argument("--no-cache", action="store_true", help="Bypass cache")

    p_ta = tab_sub.add_parser("activate", help="Activate tab")
    p_ta.add_argument("tab_id", type=int, help="Tab ID")

    # eval
    p_eval = sub.add_parser("eval", help="Execute JS in page context (MAIN world)")
    p_eval.add_argument("expression", nargs="?", default="", help="JS expression")
    p_eval.add_argument("--file", "-f", help="Read JS from file")
    p_eval.add_argument("--tab", "-t", type=int, help="Target tab ID")
    p_eval.add_argument("--url", "-u", help="Match tab by URL substring")
    p_eval.add_argument("--timeout", type=int, default=30, help="Timeout seconds")
    p_eval.add_argument("--isolated", action="store_true", help="Run in ISOLATED world instead of MAIN")

    # navigate
    p_nav = sub.add_parser("navigate", help="Navigate to URL")
    p_nav.add_argument("url", help="Target URL")
    p_nav.add_argument("--tab", "-t", type=int, help="Tab ID (creates new if omitted)")
    p_nav.add_argument("--wait", "-w", action="store_true", help="Wait for page load")

    # net
    p_net = sub.add_parser("net", help="Network capture & interception")
    net_sub = p_net.add_subparsers(dest="net_action", metavar="ACTION")

    p_ns = net_sub.add_parser("start", help="Start network capture")
    p_ns.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_ns.add_argument("--url", "-u", help="Match by URL")

    p_np = net_sub.add_parser("stop", help="Stop capture")
    p_np.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_np.add_argument("--url", "-u", help="Match by URL")

    p_nr = net_sub.add_parser("requests", help="Show captured requests")
    p_nr.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_nr.add_argument("--filter", help="URL regex filter")
    p_nr.add_argument("--method", "-m", help="HTTP method filter")
    p_nr.add_argument("--type", help="Resource type (XHR, Fetch, Document...)")
    p_nr.add_argument("--limit", "-n", type=int, help="Limit results")
    p_nr.add_argument("--completed", action="store_true", help="Only completed requests")
    p_nr.add_argument("--verbose", "-v", action="store_true", help="Show request IDs")

    p_nb = net_sub.add_parser("body", help="Get response body")
    p_nb.add_argument("request_id", help="Request ID from 'net requests -v'")
    p_nb.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_nb.add_argument("--url", "-u", help="Match by URL")
    p_nb.add_argument("-o", "--output", help="Save to file")

    p_nc = net_sub.add_parser("clear", help="Clear captured data")
    p_nc.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_nc.add_argument("--url", "-u", help="Match by URL")

    p_ni = net_sub.add_parser("intercept", help="Set intercept rules")
    p_ni.add_argument("rules", help='JSON rules: [{"urlPattern":"...","response":{"status":200,"body":"..."}}]')
    p_ni.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_ni.add_argument("--url", "-u", help="Match by URL")

    p_nis = net_sub.add_parser("intercept-stop", help="Stop interception")
    p_nis.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_nis.add_argument("--url", "-u", help="Match by URL")

    # console
    p_con = sub.add_parser("console", help="Console capture")
    con_sub = p_con.add_subparsers(dest="console_action", metavar="ACTION")

    p_cs = con_sub.add_parser("start", help="Start console capture")
    p_cs.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_cs.add_argument("--url", "-u", help="Match by URL")

    p_cp = con_sub.add_parser("stop", help="Stop capture")
    p_cp.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_cp.add_argument("--url", "-u", help="Match by URL")

    p_cm = con_sub.add_parser("messages", help="Show captured messages")
    p_cm.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_cm.add_argument("--level", help="Filter: log, warn, error, info, debug, exception")
    p_cm.add_argument("--limit", "-n", type=int, help="Limit results")

    p_cc = con_sub.add_parser("clear", help="Clear buffer")
    p_cc.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_cc.add_argument("--url", "-u", help="Match by URL")

    # cookie
    p_ck = sub.add_parser("cookie", help="Cookie management")
    ck_sub = p_ck.add_subparsers(dest="cookie_action", metavar="ACTION")

    p_cl = ck_sub.add_parser("list", help="List cookies")
    p_cl.add_argument("--domain", "-d", help="Filter by domain")
    p_cl.add_argument("--url", dest="cookie_url", help="Filter by URL")
    p_cl.add_argument("--name", "-n", help="Filter by name")

    p_cs2 = ck_sub.add_parser("set", help="Set cookie")
    p_cs2.add_argument("--url", dest="cookie_url", required=True, help="Cookie URL")
    p_cs2.add_argument("--name", "-n", required=True, help="Cookie name")
    p_cs2.add_argument("--value", "-v", required=True, help="Cookie value")
    p_cs2.add_argument("--domain", "-d", help="Domain")
    p_cs2.add_argument("--path", help="Path")
    p_cs2.add_argument("--secure", action="store_true", help="Secure flag")
    p_cs2.add_argument("--httponly", action="store_true", help="HttpOnly flag")

    p_cd = ck_sub.add_parser("delete", help="Delete cookie")
    p_cd.add_argument("--url", dest="cookie_url", required=True, help="Cookie URL")
    p_cd.add_argument("--name", "-n", required=True, help="Cookie name")

    # screenshot
    p_ss = sub.add_parser("screenshot", help="Capture visible tab")
    p_ss.add_argument("output", nargs="?", help="Output file (default: screenshot.png)")
    p_ss.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_ss.add_argument("--url", "-u", help="Match by URL")
    p_ss.add_argument("--format", choices=["png", "jpeg"], help="Image format")

    # page
    p_pg = sub.add_parser("page", help="Get page info & metrics")
    p_pg.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_pg.add_argument("--url", "-u", help="Match by URL")

    # proxy
    p_px = sub.add_parser("proxy", help="Proxy rules (mock/block/redirect/delay/header)")
    px_sub = p_px.add_subparsers(dest="proxy_action", metavar="ACTION")

    p_pxs = px_sub.add_parser("start", help="Start proxy with rules")
    p_pxs.add_argument("rules", nargs="?", help="JSON rules inline")
    p_pxs.add_argument("--file", "-f", help="Load rules from JSON file")
    p_pxs.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_pxs.add_argument("--url", "-u", help="Match by URL")

    p_pxp = px_sub.add_parser("stop", help="Stop proxy")
    p_pxp.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_pxp.add_argument("--url", "-u", help="Match by URL")

    p_pxu = px_sub.add_parser("update", help="Update proxy rules")
    p_pxu.add_argument("rules", nargs="?", help="JSON rules inline")
    p_pxu.add_argument("--file", "-f", help="Load rules from JSON file")
    p_pxu.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_pxu.add_argument("--url", "-u", help="Match by URL")

    p_pxl = px_sub.add_parser("list", help="List active rules")
    p_pxl.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_pxl.add_argument("--url", "-u", help="Match by URL")

    p_pxg = px_sub.add_parser("log", help="View proxy hit log")
    p_pxg.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_pxg.add_argument("--url", "-u", help="Match by URL")
    p_pxg.add_argument("--limit", "-n", type=int, help="Limit results")

    p_pxc = px_sub.add_parser("clear-log", help="Clear hit log")
    p_pxc.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_pxc.add_argument("--url", "-u", help="Match by URL")

    # storage
    p_st = sub.add_parser("storage", help="localStorage / sessionStorage")
    st_sub = p_st.add_subparsers(dest="storage_action", metavar="ACTION")

    p_sl = st_sub.add_parser("list", help="List storage keys")
    p_sl.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_sl.add_argument("--url", "-u", help="Match by URL")
    p_sl.add_argument("--session", "-s", action="store_true", help="Use sessionStorage")

    p_sg = st_sub.add_parser("get", help="Get value")
    p_sg.add_argument("key", help="Storage key")
    p_sg.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_sg.add_argument("--url", "-u", help="Match by URL")
    p_sg.add_argument("--session", "-s", action="store_true", help="Use sessionStorage")

    p_sv = st_sub.add_parser("set", help="Set value")
    p_sv.add_argument("key", help="Storage key")
    p_sv.add_argument("value", help="Value to set")
    p_sv.add_argument("--tab", "-t", type=int, help="Tab ID")
    p_sv.add_argument("--url", "-u", help="Match by URL")
    p_sv.add_argument("--session", "-s", action="store_true", help="Use sessionStorage")

    return parser


# ── Main ──────────────────────────────────────────────────────
def main():
    parser = build_parser()
    args = parser.parse_args()

    dispatch = {
        "status": cmd_status,
        "tabs": cmd_tabs,
        "eval": cmd_eval,
        "navigate": cmd_navigate,
        "screenshot": cmd_screenshot,
        "page": cmd_page,
    }

    # Direct commands
    if args.command in dispatch:
        dispatch[args.command](args)
        return

    # Tab subcommands
    if args.command == "tab":
        tab_dispatch = {
            "create": cmd_tab_create,
            "close": cmd_tab_close,
            "reload": cmd_tab_reload,
            "activate": cmd_tab_activate,
        }
        if args.tab_action in tab_dispatch:
            tab_dispatch[args.tab_action](args)
        else:
            print("Usage: cp tab {create|close|reload|activate}", file=sys.stderr)
        return

    # Net subcommands
    if args.command == "net":
        net_dispatch = {
            "start": cmd_net_start,
            "stop": cmd_net_stop,
            "requests": cmd_net_requests,
            "body": cmd_net_body,
            "clear": cmd_net_clear,
            "intercept": cmd_net_intercept,
            "intercept-stop": cmd_net_intercept_stop,
        }
        if args.net_action in net_dispatch:
            net_dispatch[args.net_action](args)
        else:
            print("Usage: cp net {start|stop|requests|body|clear|intercept|intercept-stop}", file=sys.stderr)
        return

    # Console subcommands
    if args.command == "console":
        console_dispatch = {
            "start": cmd_console_start,
            "stop": cmd_console_stop,
            "messages": cmd_console_messages,
            "clear": cmd_console_clear,
        }
        if args.console_action in console_dispatch:
            console_dispatch[args.console_action](args)
        else:
            print("Usage: cp console {start|stop|messages|clear}", file=sys.stderr)
        return

    # Cookie subcommands
    if args.command == "cookie":
        cookie_dispatch = {
            "list": cmd_cookie_list,
            "set": cmd_cookie_set,
            "delete": cmd_cookie_delete,
        }
        if args.cookie_action in cookie_dispatch:
            cookie_dispatch[args.cookie_action](args)
        else:
            print("Usage: cp cookie {list|set|delete}", file=sys.stderr)
        return

    # Proxy subcommands
    if args.command == "proxy":
        proxy_dispatch = {
            "start": cmd_proxy_start,
            "stop": cmd_proxy_stop,
            "update": cmd_proxy_update,
            "list": cmd_proxy_list,
            "log": cmd_proxy_log,
            "clear-log": cmd_proxy_clear_log,
        }
        if args.proxy_action in proxy_dispatch:
            proxy_dispatch[args.proxy_action](args)
        else:
            print("Usage: cp proxy {start|stop|update|list|log|clear-log}", file=sys.stderr)
        return

    # Storage subcommands
    if args.command == "storage":
        storage_dispatch = {
            "list": cmd_storage_list,
            "get": cmd_storage_get,
            "set": cmd_storage_set,
        }
        if args.storage_action in storage_dispatch:
            storage_dispatch[args.storage_action](args)
        else:
            print("Usage: cp storage {list|get|set}", file=sys.stderr)
        return

    parser.print_help()


if __name__ == "__main__":
    main()
