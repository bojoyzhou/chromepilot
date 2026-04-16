# ChromePilot

[English](./README.md)

**AI Agent 的 Chrome 驾驶舱。**

ChromePilot 让 AI Agent 能够在你**真实的 Chrome 浏览器**中执行 JavaScript、捕获网络流量、拦截 API 调用、管理 Cookie、截图——全程使用你已有的登录态。不需要傀儡浏览器，不需要 Token 搬运，不需要配置 CDP。装一个轻量 Chrome 扩展就能用。

```
AI Agent ──HTTP──▸ ChromePilot Server ──WebSocket──▸ Chrome 扩展 ──▸ 你的浏览器
                                                          │
                                                     MAIN world 执行
                                                 （你的 Cookie，你的会话）
```

## 为什么选 ChromePilot？

所有现有的浏览器自动化工具都面临同一个根本问题：**它们用不了你的登录态。**

| | ChromePilot | browser-use | Playwright / Puppeteer |
|---|---|---|---|
| 使用你真实的 Chrome | 是（扩展） | 需要 `--remote-debugging-port` | 启动独立浏览器 |
| 继承登录会话 | 自动 | 需要配置 Chrome Profile | 不支持 |
| `fetch()` 自动带 Cookie | 是（MAIN world） | 否（隔离上下文） | 否 |
| 网络捕获 | 是（扩展内 CDP） | 否 | 是 |
| 请求拦截 & Mock | 是 | 否 | 是 |
| Console 捕获 | 是 | 否 | 是 |
| Cookie 管理 | 是（chrome.cookies API） | 通过 CLI | 通过 CDP |
| 配置复杂度 | 安装扩展 | 安装二进制 + 配置 | 安装浏览器 + 驱动 |
| 依赖 | Python + aiohttp | Rust 二进制 | Node.js + 浏览器二进制 |
| 单次命令延迟 | ~15ms | ~50ms | ~30ms |

关键差异在架构层面。CDP 类工具将脚本注入到**隔离的世界（isolated world）**中——你的 `fetch("/api/data")` 不会携带页面的认证 Cookie。ChromePilot 的扩展通过 `chrome.scripting.executeScript` 在 **MAIN world** 中执行代码，你的 JavaScript 就像在浏览器控制台中手动输入一样运行。每一个 `fetch` 调用、每一个 `XMLHttpRequest`、每一次 `document.cookie` 访问，行为都与真实页面完全一致。

这一点至关重要，因为最有价值的浏览器自动化场景恰恰涉及**需要认证的内部工具**——数据看板、管理后台、项目管理系统、监控平台——这些系统的认证流程要么复杂（SSO、MFA、证书认证），要么根本无法用程序模拟。使用 ChromePilot，只要你在 Chrome 里能看到的，Agent 就能操作。

## 快速开始

### 1. 安装 Chrome 扩展

1. 打开 `chrome://extensions/`
2. 开启右上角的**开发者模式**
3. 点击**加载已解压的扩展程序** → 选择 `extension/` 目录
4. 看到 "ChromePilot" 出现并显示绿色状态即可

### 2. 启动服务

```bash
pip install aiohttp
python3 server.py
```

```
[chromepilot] ChromePilot Server v2.0.0
[chromepilot] Listening on http://192.168.1.100:8787
[chromepilot] Waiting for Chrome extension to connect...
[chromepilot] ✓ Extension connected
```

### 3. 开始使用

```bash
python3 cp.py status
#   Extension: ✓ Connected
#   Server:    v2.0.0
#   Port:      8787

python3 cp.py tabs
#   * [887966267] Google - Chrome
#           https://www.google.com
#     [887967344] 内部看板 - Dashboard
#           https://internal.company.com/dashboard

python3 cp.py eval 'document.title'
# Google
```

就这些。不需要配置文件，不需要环境变量，不需要下载浏览器二进制。

## 实战示例

### 从已登录的内部系统中提取数据

Agent 需要从内部项目看板拉取数据，用户已经通过 SSO 登录。

```bash
# 找到目标标签页
cp tabs
#     [42001] 项目看板 - Acme Corp
#           https://dashboard.internal.com/projects

# 执行 fetch，Cookie 自动携带——无需任何额外配置
cp eval 'fetch("/api/v1/projects?status=active").then(r => r.json()).then(d => JSON.stringify(d))' --url dashboard
# [{"id":1,"name":"项目Alpha","status":"active","owner":"alice"}, ...]
```

使用任何 CDP 类工具，这个 `fetch` 都会返回 401，因为请求不会携带会话 Cookie。而 ChromePilot 直接就能用。

### 逆向分析陌生 Web 应用的 API

你打开了一个新的内部工具，需要搞清楚它调用了哪些 API。与其去读压缩混淆的源码，不如直接观察网络流量：

```bash
# 在目标标签页上开始捕获
cp net start --url dashboard

# 触发一些用户操作
cp eval 'document.querySelector(".refresh-btn").click()' --url dashboard

# 查看调用了哪些 API
cp net requests --type Fetch --completed -v
#   ← POST 200 https://dashboard.internal.com/graphql [2.3KB] application/json
#     requestId: 1001.42
#   ← GET 200 https://dashboard.internal.com/api/metrics?range=7d [890B] application/json
#     requestId: 1001.43

# 查看 GraphQL 请求的 body
cp net body 1001.42
# {
#   "query": "query GetProjects($status: String!) { projects(status: $status) { id name owner } }",
#   "variables": {"status": "active"}
# }

# 现在你知道了完整的 API 契约——直接复用
cp eval 'fetch("/graphql", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({
    query: "query GetProjects($status: String!) { projects(status: $status) { id name owner } }",
    variables: {status: "active"}
  })
}).then(r => r.json()).then(d => JSON.stringify(d))' --url dashboard
```

Agent 纯粹通过观察网络流量就发现了 API 的结构——完全不需要文档。

### Mock API 响应来测试边界场景

你想看页面如何处理错误状态，但真实 API 总是返回成功：

```bash
# 设置拦截规则：mock 定价 API 返回错误
cp net intercept '[{
  "urlPattern": "api/pricing",
  "response": {
    "status": 500,
    "headers": {"content-type": "application/json"},
    "body": "{\"error\": \"服务暂时不可用\"}"
  }
}]' --url myapp

# 刷新页面——它会命中我们的 mock 而非真实 API
cp tab reload --url myapp

# 检查应用是否正确展示了错误状态
cp screenshot error-state.png --url myapp

# 查看控制台是否有未捕获的错误
cp console start --url myapp
cp eval 'document.querySelector(".retry-btn").click()' --url myapp
cp console messages --level error
#   ✗ Uncaught TypeError: Cannot read properties of undefined (reading 'price')
#       at PricingWidget.render (pricing.js:42)

# 清理
cp net intercept-stop --url myapp
```

你刚刚发现了一个 Bug——应用没有优雅地处理 API 错误。而且你完全没碰后端代码。

### 监控长时间运行的流程

你正在 Web 界面上看一个部署流水线，希望状态变化时能及时知道：

```bash
# 启动 console + 网络捕获
cp console start --url pipeline
cp net start --url pipeline

# 轮询状态变化
while true; do
  status=$(cp eval 'document.querySelector(".pipeline-status")?.textContent' --url pipeline)
  echo "[$(date +%H:%M:%S)] 状态: $status"
  
  if [ "$status" = "Success" ] || [ "$status" = "Failed" ]; then
    # 捕获最终状态
    cp screenshot "pipeline-$(date +%Y%m%d-%H%M%S).png" --url pipeline
    cp console messages --level error -n 5
    cp net requests --filter "api/deploy" --completed
    break
  fi
  sleep 10
done
```

### 管理浏览器状态用于测试

```bash
# 查看当前有哪些 Cookie
cp cookie list --domain .myapp.com
#   🔒H .myapp.com    session_token    eyJhbGciOiJIUz...
#   🔒  .myapp.com    theme            dark
#      .myapp.com    onboarding       completed

# 修改 Cookie 来测试不同的用户状态
cp cookie set --url https://myapp.com --name onboarding --value pending

# 查看 localStorage
cp storage list --url myapp
#   localStorage: 12 个键
#     user_preferences
#     feature_flags
#     cache_v2

# 读取特定值
cp storage get feature_flags --url myapp
# {"dark_mode": true, "beta_features": false, "new_editor": true}

# 切换功能开关
cp storage set feature_flags '{"dark_mode":true,"beta_features":true,"new_editor":true}' --url myapp

# 刷新并验证
cp tab reload --url myapp
cp screenshot feature-flags-test.png --url myapp
```

### 获取页面性能指标

```bash
cp page --url myapp
#   URL:            https://myapp.com/dashboard
#   标题:           Dashboard - MyApp
#   就绪状态:       complete
#   内容类型:       text/html
#   Cookie 数量:    15
#   localStorage:   12 个键
#   sessionStorage: 3 个键
#   DOMContentLoaded: 847ms
#   Load:           1203ms
```

## 命令参考

### 全局选项

```
--port PORT     服务端口（默认: 8787）
--json          输出原始 JSON，便于程序化处理
```

标签页定位（大多数命令都支持）：

```
--tab ID        通过 Chrome 标签页 ID 指定
--url MATCH     通过 URL 子串匹配目标标签页
（省略）         使用当前活跃标签页
```

### 命令一览

```bash
# 连接
cp status                                    # 检查服务器 + 扩展状态

# 标签页
cp tabs                                      # 列出所有标签页及 ID
cp tab create [URL]                          # 打开新标签页
cp tab close TAB_ID                          # 关闭标签页
cp tab reload [--tab ID] [--no-cache]        # 刷新标签页
cp tab activate TAB_ID                       # 激活标签页（切到前台）

# JavaScript 执行
cp eval 'expression'                         # 在 MAIN world（页面上下文）中执行 JS
cp eval -f script.js [--url match]           # 执行 JS 文件
cp eval 'expr' --isolated                    # 在 ISOLATED world 中执行

# 导航
cp navigate URL [--tab ID] [--wait]          # 导航到 URL（--wait 等待加载完成）

# 网络捕获
cp net start [--tab ID]                      # 开始捕获
cp net requests [--filter PAT] [--method M]  # 查看捕获的请求
cp net requests --type Fetch --completed -v  # 过滤 + 显示请求 ID
cp net body REQUEST_ID [-o file.json]        # 获取响应体
cp net clear                                 # 清空缓冲区
cp net stop                                  # 停止捕获

# 网络拦截
cp net intercept 'RULES_JSON' [--tab ID]     # 设置 Mock 规则
cp net intercept-stop                        # 移除所有规则

# Console 捕获
cp console start [--tab ID]                  # 开始捕获
cp console messages [--level error] [-n 20]  # 查看消息
cp console clear                             # 清空缓冲区
cp console stop                              # 停止捕获

# Cookie
cp cookie list [--domain D] [--url U]        # 列出 Cookie
cp cookie set --url U --name N --value V     # 设置 Cookie
cp cookie delete --url U --name N            # 删除 Cookie

# 截图
cp screenshot [output.png] [--format jpeg]   # 截取可见区域

# 页面信息
cp page [--tab ID]                           # URL、标题、加载时间、存储统计

# 存储
cp storage list [--session]                  # 列出 localStorage/sessionStorage 键
cp storage get KEY                           # 获取值（JSON 自动格式化）
cp storage set KEY VALUE                     # 设置值
```

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                    你的 Chrome 浏览器                     │
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                │
│  │  标签 1  │  │  标签 2  │  │  标签 3  │   ...         │
│  │ (已通过  │  │ (已通过  │  │ (任意   │               │
│  │  SSO    │  │  OAuth  │  │  页面)   │               │
│  │  登录)   │  │  登录)   │  │          │               │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│  ┌────┴──────────────┴──────────────┴────────────────┐  │
│  │            ChromePilot 扩展 (MV3)                  │  │
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
              │   WebSocket 中继      │
              │   SSE 事件流          │
              └───────────┬───────────┘
                          │ HTTP
              ┌───────────┴───────────┐
              │   CLI (cp.py)         │
              │   或任意 HTTP 客户端   │
              │   或你的 AI Agent      │
              └───────────────────────┘
```

**为什么选择这种架构？**

Chrome 扩展方案解决了 CDP 无法解决的问题：

1. **MAIN world 执行** — `chrome.scripting.executeScript({world: "MAIN"})` 让你的代码运行在页面自身的 JavaScript 上下文中。变量、Cookie、fetch 拦截器——一切都与页面共享。CDP 的 `Runtime.evaluate` 默认运行在隔离上下文中。

2. **零配置认证** — 扩展天然继承用户已有的登录态。SSO、OAuth、证书认证、MFA——只要用户已经登录，Agent 就已经登录。不需要重放认证流程。

3. **不需要重启浏览器** — CDP 需要 Chrome 以 `--remote-debugging-port` 参数启动。ChromePilot 可以在任何正在运行的 Chrome 实例上工作——安装扩展即可。

4. **Debugger API 访问** — 扩展可以使用 `chrome.debugger` 对单个标签页挂载 DevTools 协议，实现网络捕获和请求拦截，无需 Chrome 级别的 CDP 访问。

## 集成方式

### 作为 Agent Skill

ChromePilot 附带 Agent Skill 定义文件，教 AI Agent 如何使用每个命令。

兼容：**QoderWork** / **Cursor** / **Claude Code** / **Qoder** / **Codex**

### 作为 HTTP API

服务暴露简洁的 REST API，任何 HTTP 客户端都能调用：

```bash
# 列出标签页
curl http://localhost:8787/tabs

# 执行 JS
curl -X POST http://localhost:8787/evaluate \
  -H "Content-Type: application/json" \
  -d '{"expression": "document.title", "urlMatch": "myapp"}'

# 开始网络捕获
curl -X POST http://localhost:8787/network/start \
  -d '{"urlMatch": "myapp"}'

# 获取捕获的请求
curl "http://localhost:8787/network/requests?tabId=42001&urlPattern=api&completed=true"

# 实时事件流 (SSE)
curl http://localhost:8787/events?types=net,console
```

### 实时事件流

`/events` 端点提供 Server-Sent Events，用于实时监控：

```bash
curl -N http://localhost:8787/events?types=net.request,console

data: {"type":"net.request","tabId":42001,"data":{"url":"https://api.example.com/data","method":"GET","type":"Fetch"}}
data: {"type":"console","tabId":42001,"data":{"level":"log","args":["收到 API 响应"]}}
data: {"type":"net.response","tabId":42001,"data":{"url":"https://api.example.com/data","status":200,"mimeType":"application/json"}}
```

## 环境要求

- **Chrome**（任意较新版本）并加载 ChromePilot 扩展
- **Python 3.8+** 及 `aiohttp`（`pip install aiohttp`）
- 就这些。不需要下载 Chromium，不需要 Node.js，不需要 Selenium，不需要 WebDriver。

## 常见问题

**Q: 会出现"Chrome 正在被自动化测试软件控制"的横幅吗？**
A: 不会。那个横幅是 CDP/DevTools 协议连接触发的。ChromePilot 使用标准 Chrome 扩展——没有自动化横幅，不会被反爬虫系统检测到。

**Q: 那 debugger 横幅呢？**
A: 当你使用 `cp net start` 或 `cp console start` 时，Chrome 会在对应标签页上显示"已开始调试此浏览器"的提示栏。这是正常现象——说明 `chrome.debugger` API 已经挂载到该标签页用于网络/控制台捕获。执行 `cp net stop` / `cp console stop` 后会消失。

**Q: 可以配合无头 Chrome 使用吗？**
A: ChromePilot 专为有界面的真实 Chrome 及其已有的用户会话设计。如果你需要无头自动化且不依赖登录态，请使用 Playwright 或 Puppeteer——它们更适合那个场景。

**Q: 安全性如何？**
A: 服务默认只监听 localhost。扩展只连接 `127.0.0.1:8787`。除非你的脚本主动发送，否则没有任何数据会离开你的机器。

## 许可证

MIT
