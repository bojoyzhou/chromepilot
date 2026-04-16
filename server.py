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
import uuid
import socket
import argparse
from collections import deque
from aiohttp import web

# ── State ─────────────────────────────────────────────────────
ws_client = None
pending = {}              # req_id → Future
event_buffer = deque(maxlen=500)
sse_clients = []          # list of (queue, filter_types)

# ── WebSocket Handler ─────────────────────────────────────────
async def ws_handler(request):
    global ws_client
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    ws_client = ws
    print("[chromepilot] ✓ Extension connected")

    try:
        async for msg in ws:
            if msg.type != web.WSMsgType.TEXT:
                continue
            data = json.loads(msg.data)

            # Real-time events from extension (network, console)
            if data.get("_event"):
                event = {
                    "type": data["type"],
                    "tabId": data.get("tabId"),
                    "data": data.get("data"),
                    "ts": data.get("ts"),
                }
                event_buffer.append(event)
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
    parser.add_argument("--host", default="0.0.0.0", help="Bind host (default: 0.0.0.0)")
    args = parser.parse_args()

    lan_ip = _get_lan_ip()
    print(f"[chromepilot] ChromePilot Server v2.0.0")
    print(f"[chromepilot] Listening on http://{lan_ip}:{args.port}")
    print(f"[chromepilot] Waiting for Chrome extension to connect...")
    web.run_app(app, host=args.host, port=args.port, print=None)
