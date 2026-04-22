#!/usr/bin/env python3
"""
ChromePilot Server — HTTP + WebSocket bridge between CLI and Chrome Extension.

Architecture:
  CLI (cp.py) → HTTP REST API → this server → WebSocket → Chrome Extension → Chrome APIs

Start:
  python3 server.py [--port 8787]

API:
  GET  /status                    Connection status
  GET  /tabs                      List browser tabs
  POST /tab/create                Create tab: {"url": "..."}
  POST /tab/close                 Close tab: {"tabId": 123}
  POST /tab/reload                Reload: {"tabId": 123} or {"urlMatch": "..."}
  POST /tab/activate              Activate: {"tabId": 123}
  POST /evaluate                  Execute JS: {"expression": "...", "tabId"?, "urlMatch"?, "world"?}
  POST /navigate                  Navigate: {"url": "...", "tabId"?, "waitForLoad"?}
  POST /network/start             Start capture: {"tabId"?, "urlMatch"?}
  POST /network/stop              Stop capture: {"tabId"?, "urlMatch"?}
  GET  /network/requests          Get captured: ?tabId=&urlPattern=&method=&limit=
  POST /network/clear             Clear buffer: {"tabId"?, "urlMatch"?}
  POST /network/body              Get response body: {"requestId": "...", "tabId"?}
  POST /network/intercept         Set rules: {"rules": [...], "tabId"?}
  POST /network/intercept/stop    Stop intercept: {"tabId"?}
  POST /console/start             Start capture: {"tabId"?}
  POST /console/stop              Stop capture: {"tabId"?}
  GET  /console/messages           Get captured: ?tabId=&level=&limit=
  POST /console/clear             Clear buffer: {"tabId"?}
  GET  /cookies                   List: ?domain=&url=&name=
  POST /cookies                   Set cookie: {"url","name","value",...}
  DELETE /cookies                 Delete: {"url","name"}
  POST /screenshot                Capture: {"tabId"?, "format"?}
  GET  /page/info                 Page metrics: ?tabId=&urlMatch=
  GET  /events                    SSE event stream: ?types=net,console
"""

import asyncio
import json
import os
import uuid
import socket
import argparse
import re
import time
import ssl
import base64
from collections import deque
from urllib.parse import urlparse
import aiohttp
from aiohttp import web

# ── State ─────────────────────────────────────────────────────
ws_client = None
pending = {}              # req_id → Future
event_buffer = deque(maxlen=500)
sse_clients = []          # list of (queue, filter_types)

# ── Proxy Persistence ─────────────────────────────────────────
_PROXY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxy-rules.json")
proxy_store = {}          # str(tabId) → {"rules": [...], "urlMatch"?: str}


def _load_proxy_rules():
    global proxy_store
    try:
        with open(_PROXY_FILE, "r") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            print(f"[chromepilot] ⚠ Invalid proxy rules format, expected dict — starting fresh")
            proxy_store = {}
            return
        proxy_store = data
        if proxy_store:
            print(f"[chromepilot] ↻ Loaded {len(proxy_store)} saved proxy rule set(s) from {os.path.basename(_PROXY_FILE)}")
    except FileNotFoundError:
        proxy_store = {}
    except (json.JSONDecodeError, Exception) as e:
        print(f"[chromepilot] ⚠ Failed to load proxy rules: {e} — starting fresh")
        proxy_store = {}


def _save_proxy_rules():
    try:
        with open(_PROXY_FILE, "w") as f:
            json.dump(proxy_store, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[chromepilot] ⚠ Failed to save proxy rules: {e}")


async def _replay_proxy_rules():
    """Replay persisted proxy rules to extension after reconnect."""
    if not proxy_store:
        return

    # Global proxy takes priority
    if "_global" in proxy_store:
        data = proxy_store["_global"]
        rules = data.get("rules", [])
        if rules:
            try:
                cmd = {"action": "proxy_start_global", "rules": rules}
                if data.get("whistleText"):
                    cmd["whistleText"] = data["whistleText"]
                result = await _send(cmd, timeout=10)
                if "error" not in result:
                    tab_count = result.get("tabCount", 0)
                    print(f"[chromepilot] \u21BB Restored global proxy ({len(rules)} rules, {tab_count} tabs)")
                    # If proxy was paused before, pause it again
                    if data.get("paused"):
                        try:
                            await _send({"action": "proxy_pause_global"}, timeout=5)
                            print(f"[chromepilot] \u23F8 Global proxy restored in paused state")
                        except Exception:
                            pass
                else:
                    print(f"[chromepilot] \u26A0 Global proxy restore failed: {result['error']}")
            except Exception as e:
                print(f"[chromepilot] \u26A0 Global proxy restore error: {e}")
        return  # Don't replay per-tab if global is active

    # Per-tab proxy rules
    for tab_id_str, data in list(proxy_store.items()):
        if tab_id_str == "_global":
            continue
        rules = data.get("rules", [])
        if not rules:
            continue
        try:
            cmd = {"action": "proxy_start", "tabId": int(tab_id_str), "rules": rules}
            if data.get("urlMatch"):
                cmd["urlMatch"] = data["urlMatch"]
            result = await _send(cmd, timeout=10)
            if "error" not in result:
                print(f"[chromepilot] \u21BB Restored proxy for tab {tab_id_str} ({len(rules)} rules)")
                # Push whistleText to extension so popup can display it
                if data.get("whistleText"):
                    await ws_client.send_json({
                        "_event": True, "type": "proxy.set_whistle_text",
                        "tabId": int(tab_id_str), "whistleText": data["whistleText"],
                    })
            else:
                print(f"[chromepilot] \u26A0 Proxy restore failed for tab {tab_id_str}: {result['error']}")
                del proxy_store[tab_id_str]
                _save_proxy_rules()
        except Exception as e:
            print(f"[chromepilot] \u26A0 Proxy restore error for tab {tab_id_str}: {e}")

# ── WebSocket Handler ─────────────────────────────────────────
async def ws_handler(request):
    global ws_client
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    ws_client = ws
    print("[chromepilot] ✓ Extension connected")

    # Replay persisted proxy rules to extension
    await _replay_proxy_rules()

    try:
        async for msg in ws:
            if msg.type != web.WSMsgType.TEXT:
                continue
            data = json.loads(msg.data)

            # Real-time events from extension (network, console)
            if data.get("_event"):
                evt_type = data["type"]
                event = {
                    "type": evt_type,
                    "tabId": data.get("tabId"),
                    "data": data.get("data"),
                    "ts": data.get("ts"),
                }
                event_buffer.append(event)

                # Handle proxy rules updated from popup editor
                if evt_type == "proxy.rules_updated":
                    tab_id = str(data.get("tabId", ""))
                    rules = data.get("rules", [])
                    whistle_text = data.get("whistleText")
                    if tab_id and tab_id in proxy_store:
                        proxy_store[tab_id]["rules"] = rules
                        if whistle_text is not None:
                            proxy_store[tab_id]["whistleText"] = whistle_text
                        _save_proxy_rules()
                        print(f"[chromepilot] \u270E Proxy rules updated for tab {tab_id} ({len(rules)} rules)")

                # Handle global proxy updated from popup editor
                if evt_type == "proxy.global_updated":
                    rules = data.get("rules", [])
                    whistle_text = data.get("whistleText")
                    proxy_store["_global"] = {"rules": rules}
                    if whistle_text is not None:
                        proxy_store["_global"]["whistleText"] = whistle_text
                    _save_proxy_rules()
                    print(f"[chromepilot] \u270E Global proxy updated ({len(rules)} rules)")

                # Handle global proxy stopped
                if evt_type == "proxy.global_stopped":
                    if "_global" in proxy_store:
                        del proxy_store["_global"]
                        _save_proxy_rules()
                    print(f"[chromepilot] \u2717 Global proxy stopped")

                # Handle global proxy paused/resumed
                if evt_type == "proxy.global_paused":
                    if "_global" in proxy_store:
                        proxy_store["_global"]["paused"] = True
                        _save_proxy_rules()
                    print(f"[chromepilot] \u23F8 Global proxy paused")

                if evt_type == "proxy.global_resumed":
                    if "_global" in proxy_store:
                        proxy_store["_global"].pop("paused", None)
                        _save_proxy_rules()
                    print(f"[chromepilot] \u25B6 Global proxy resumed")

                # Fan out to SSE clients
                for queue, types in sse_clients:
                    if not types or any(event["type"].startswith(t) for t in types):
                        try:
                            queue.put_nowait(event)
                        except asyncio.QueueFull:
                            pass
                continue

            # Response to a pending request
            req_id = data.get("id")
            if req_id and req_id in pending:
                pending[req_id].set_result(data)
    finally:
        ws_client = None
        print("[chromepilot] ✗ Extension disconnected")
    return ws


# ── Bridge helpers ────────────────────────────────────────────
def _check():
    if not ws_client or ws_client.closed:
        return web.json_response(
            {"error": "Extension not connected. Install the ChromePilot extension and open Chrome."},
            status=503,
        )
    return None


async def _send(cmd, timeout=30):
    req_id = uuid.uuid4().hex[:8]
    cmd["id"] = req_id
    fut = asyncio.get_event_loop().create_future()
    pending[req_id] = fut
    try:
        await ws_client.send_json(cmd)
        return await asyncio.wait_for(fut, timeout=timeout)
    except asyncio.TimeoutError:
        return {"error": "Timeout waiting for extension response"}
    finally:
        pending.pop(req_id, None)


async def _forward(action, request, extra=None, timeout=30, query_params=None):
    """Forward an action to the extension and return the response."""
    err = _check()
    if err:
        return err

    cmd = {"action": action}

    # Merge body (POST) or query params (GET)
    if request.method in ("POST", "PUT", "DELETE"):
        try:
            body = await request.json()
            cmd.update(body)
        except Exception:
            pass
    if query_params:
        for key, cast in query_params.items():
            val = request.query.get(key)
            if val is not None:
                cmd[key] = cast(val)
    if extra:
        cmd.update(extra)

    timeout = cmd.pop("timeout", timeout)
    result = await _send(cmd, timeout=timeout)
    if "error" in result:
        return web.json_response({"error": result["error"]}, status=400)
    # Strip internal fields
    result.pop("id", None)
    return web.json_response(result)


# ── Route Handlers ────────────────────────────────────────────

async def handle_status(request):
    connected = ws_client is not None and not ws_client.closed
    return web.json_response({"connected": connected, "version": "2.0.0"})


# Tabs
async def handle_tabs(request):
    return await _forward("list_tabs", request)

async def handle_tab_create(request):
    return await _forward("tab_create", request)

async def handle_tab_close(request):
    return await _forward("tab_close", request)

async def handle_tab_reload(request):
    return await _forward("tab_reload", request)

async def handle_tab_activate(request):
    return await _forward("tab_activate", request)


# Evaluate & Navigate
async def handle_evaluate(request):
    return await _forward("evaluate", request, timeout=60)

async def handle_navigate(request):
    return await _forward("navigate", request, timeout=60)


# Network
async def handle_network_start(request):
    return await _forward("network_start", request)

async def handle_network_stop(request):
    return await _forward("network_stop", request)

async def handle_network_requests(request):
    return await _forward("network_requests", request, query_params={
        "tabId": int, "urlPattern": str, "method": str, "type": str,
        "status": int, "limit": int, "completed": lambda v: v == "true",
    })

async def handle_network_clear(request):
    return await _forward("network_clear", request)

async def handle_network_body(request):
    return await _forward("network_body", request, timeout=15)

async def handle_network_intercept(request):
    return await _forward("network_intercept", request)

async def handle_network_intercept_stop(request):
    return await _forward("network_intercept_stop", request)


# Console
async def handle_console_start(request):
    return await _forward("console_start", request)

async def handle_console_stop(request):
    return await _forward("console_stop", request)

async def handle_console_messages(request):
    return await _forward("console_messages", request, query_params={
        "tabId": int, "level": str, "limit": int,
    })

async def handle_console_clear(request):
    return await _forward("console_clear", request)


# Cookies
async def handle_cookie_list(request):
    return await _forward("cookie_list", request, query_params={
        "domain": str, "url": str, "name": str,
    })

async def handle_cookie_set(request):
    return await _forward("cookie_set", request)

async def handle_cookie_delete(request):
    return await _forward("cookie_delete", request)


# Screenshot
async def handle_screenshot(request):
    return await _forward("screenshot", request)


# Page info
async def handle_page_info(request):
    return await _forward("page_info", request, query_params={
        "tabId": int, "urlMatch": str,
    })


# Proxy (with persistence)
async def handle_proxy_start(request):
    err = _check()
    if err:
        return err
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    cmd = {"action": "proxy_start", **body}
    timeout = cmd.pop("timeout", 30)
    result = await _send(cmd, timeout=timeout)
    if "error" in result:
        return web.json_response({"error": result["error"]}, status=400)
    result.pop("id", None)
    # Persist
    tab_id = str(result.get("tabId", body.get("tabId", "")))
    if tab_id:
        proxy_store[tab_id] = {"rules": body.get("rules", [])}
        if body.get("urlMatch"):
            proxy_store[tab_id]["urlMatch"] = body["urlMatch"]
        _save_proxy_rules()
    return web.json_response(result)

async def handle_proxy_stop(request):
    err = _check()
    if err:
        return err
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    cmd = {"action": "proxy_stop", **body}
    result = await _send(cmd, timeout=30)
    if "error" in result:
        return web.json_response({"error": result["error"]}, status=400)
    result.pop("id", None)
    # Remove from persistence — find tabId from body or resolve
    tab_id = str(body.get("tabId", ""))
    if not tab_id:
        # Try to find by urlMatch in store
        for tid in list(proxy_store.keys()):
            if proxy_store[tid].get("urlMatch") == body.get("urlMatch"):
                tab_id = tid
                break
    if tab_id and tab_id in proxy_store:
        del proxy_store[tab_id]
        _save_proxy_rules()
    return web.json_response(result)

async def handle_proxy_update(request):
    err = _check()
    if err:
        return err
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    cmd = {"action": "proxy_update", **body}
    result = await _send(cmd, timeout=30)
    if "error" in result:
        return web.json_response({"error": result["error"]}, status=400)
    result.pop("id", None)
    # Update persistence
    tab_id = str(body.get("tabId", ""))
    if not tab_id:
        for tid in list(proxy_store.keys()):
            if proxy_store[tid].get("urlMatch") == body.get("urlMatch"):
                tab_id = tid
                break
    if tab_id and tab_id in proxy_store:
        proxy_store[tab_id]["rules"] = body.get("rules", [])
        _save_proxy_rules()
    return web.json_response(result)

async def handle_proxy_list(request):
    return await _forward("proxy_list", request, query_params={
        "tabId": int, "urlMatch": str,
    })

async def handle_proxy_log(request):
    return await _forward("proxy_log", request, query_params={
        "tabId": int, "urlMatch": str, "limit": int,
    })

async def handle_proxy_clear_log(request):
    return await _forward("proxy_clear_log", request)


# Global Proxy (with persistence)
async def handle_proxy_start_global(request):
    err = _check()
    if err:
        return err
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    cmd = {"action": "proxy_start_global", **body}
    timeout = cmd.pop("timeout", 30)
    result = await _send(cmd, timeout=timeout)
    if "error" in result:
        return web.json_response({"error": result["error"]}, status=400)
    result.pop("id", None)
    # Persist
    proxy_store["_global"] = {"rules": body.get("rules", [])}
    if body.get("whistleText"):
        proxy_store["_global"]["whistleText"] = body["whistleText"]
    _save_proxy_rules()
    return web.json_response(result)

async def handle_proxy_stop_global(request):
    err = _check()
    if err:
        return err
    cmd = {"action": "proxy_stop_global"}
    result = await _send(cmd, timeout=30)
    if "error" in result:
        return web.json_response({"error": result["error"]}, status=400)
    result.pop("id", None)
    if "_global" in proxy_store:
        del proxy_store["_global"]
        _save_proxy_rules()
    return web.json_response(result)


# Proxy Fetch — forward request via server with custom DNS (correct TLS SNI)
class _IPResolver(aiohttp.abc.AbstractResolver):
    """Resolve a specific hostname to a given IP or hostname, passthrough for others."""
    def __init__(self, host, target):
        self._host = host
        self._target = target

    async def resolve(self, host, port=0, family=socket.AF_INET):
        target = self._target if host == self._host else host
        # If target is a hostname (not an IP address), resolve it first
        try:
            socket.inet_aton(target)
        except OSError:
            # Not a valid IPv4 address — resolve as hostname
            loop = asyncio.get_running_loop()
            infos = await loop.getaddrinfo(target, port, family=family, type=socket.SOCK_STREAM)
            if infos:
                target = infos[0][4][0]
        return [{
            "hostname": host, "host": target, "port": port,
            "family": family, "proto": 0, "flags": 0,
        }]

    async def close(self):
        pass


async def handle_proxy_fetch(request):
    """Fetch a URL with domain→IP override, preserving correct TLS SNI."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    original_url = body.get("url", "")
    ip = body.get("ip", "")
    host = body.get("host", "")
    method = body.get("method", "GET")
    req_headers = body.get("headers", {})
    post_data = body.get("postData")  # Forward request body for POST/PUT/PATCH

    if not original_url or not ip or not host:
        return web.json_response({"error": "url, ip, host required"}, status=400)

    # Build clean request headers (remove hop-by-hop headers)
    skip = {"host", "connection", "accept-encoding", "content-length", "transfer-encoding"}
    clean_headers = {k: v for k, v in req_headers.items() if k.lower() not in skip}
    clean_headers["Host"] = host

    # SSL context: trust any cert (IP host mapping = dev tool)
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    resolver = _IPResolver(host, ip)
    connector = aiohttp.TCPConnector(resolver=resolver, ssl=ssl_ctx)

    try:
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.request(
                method, original_url,
                headers=clean_headers,
                data=post_data.encode("utf-8") if post_data else None,
                allow_redirects=False,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                resp_body = await resp.read()

                # Collect response headers (skip hop-by-hop & encoding since we decompress)
                resp_headers = {}
                skip_resp = {"transfer-encoding", "content-encoding", "content-length"}
                for k, v in resp.headers.items():
                    if k.lower() not in skip_resp:
                        resp_headers[k] = v
                # Set correct content-length for the decompressed body
                resp_headers["content-length"] = str(len(resp_body))

                return web.json_response({
                    "status": resp.status,
                    "headers": resp_headers,
                    "body": base64.b64encode(resp_body).decode(),
                })
    except Exception as e:
        return web.json_response({"error": f"Fetch failed: {e}"}, status=502)
    finally:
        await connector.close()


# SSE event stream
async def handle_events(request):
    types_raw = request.query.get("types", "")
    types = [t.strip() for t in types_raw.split(",") if t.strip()] if types_raw else []

    response = web.StreamResponse(
        status=200,
        reason="OK",
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
    await response.prepare(request)

    queue = asyncio.Queue(maxsize=100)
    entry = (queue, types)
    sse_clients.append(entry)

    try:
        # Send recent events as catch-up
        for ev in event_buffer:
            if not types or any(ev["type"].startswith(t) for t in types):
                line = f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                await response.write(line.encode())

        # Stream new events
        while True:
            event = await queue.get()
            line = f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            await response.write(line.encode())
    except (asyncio.CancelledError, ConnectionResetError):
        pass
    finally:
        sse_clients.remove(entry)
    return response


# ── App Setup ─────────────────────────────────────────────────
app = web.Application()
app.router.add_get("/ws", ws_handler)
app.router.add_get("/status", handle_status)

# Tabs
app.router.add_get("/tabs", handle_tabs)
app.router.add_post("/tab/create", handle_tab_create)
app.router.add_post("/tab/close", handle_tab_close)
app.router.add_post("/tab/reload", handle_tab_reload)
app.router.add_post("/tab/activate", handle_tab_activate)

# Core
app.router.add_post("/evaluate", handle_evaluate)
app.router.add_post("/navigate", handle_navigate)

# Network
app.router.add_post("/network/start", handle_network_start)
app.router.add_post("/network/stop", handle_network_stop)
app.router.add_get("/network/requests", handle_network_requests)
app.router.add_post("/network/clear", handle_network_clear)
app.router.add_post("/network/body", handle_network_body)
app.router.add_post("/network/intercept", handle_network_intercept)
app.router.add_post("/network/intercept/stop", handle_network_intercept_stop)

# Console
app.router.add_post("/console/start", handle_console_start)
app.router.add_post("/console/stop", handle_console_stop)
app.router.add_get("/console/messages", handle_console_messages)
app.router.add_post("/console/clear", handle_console_clear)

# Cookies
app.router.add_get("/cookies", handle_cookie_list)
app.router.add_post("/cookies", handle_cookie_set)
app.router.add_delete("/cookies", handle_cookie_delete)

# Screenshot & Page
app.router.add_post("/screenshot", handle_screenshot)
app.router.add_get("/page/info", handle_page_info)

# Proxy
app.router.add_post("/proxy/start", handle_proxy_start)
app.router.add_post("/proxy/stop", handle_proxy_stop)
app.router.add_post("/proxy/update", handle_proxy_update)
app.router.add_get("/proxy/rules", handle_proxy_list)
app.router.add_get("/proxy/log", handle_proxy_log)
app.router.add_post("/proxy/clear-log", handle_proxy_clear_log)
app.router.add_post("/proxy/start-global", handle_proxy_start_global)
app.router.add_post("/proxy/stop-global", handle_proxy_stop_global)
app.router.add_post("/proxy/fetch", handle_proxy_fetch)

# Events
app.router.add_get("/events", handle_events)


if __name__ == "__main__":
    def _get_lan_ip():
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    parser = argparse.ArgumentParser(description="ChromePilot Server")
    parser.add_argument("--port", type=int, default=8787, help="Server port (default: 8787)")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    args = parser.parse_args()

    lan_ip = _get_lan_ip()
    _load_proxy_rules()
    display_host = lan_ip if args.host == "0.0.0.0" else args.host
    print(f"[chromepilot] ChromePilot Server v2.0.0")
    print(f"[chromepilot] Listening on http://{display_host}:{args.port}")
    print(f"[chromepilot] Waiting for Chrome extension to connect...")
    web.run_app(app, host=args.host, port=args.port, print=None)
