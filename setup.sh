#!/bin/bash
# ─────────────────────────────────────────────────────────
# ChromePilot 一键安装脚本
# 用法: bash setup.sh
# ─────────────────────────────────────────────────────────
set -e

# ── 颜色 ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── 路径 ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTENSION_DIR="$SCRIPT_DIR/extension"
SERVER_SCRIPT="$SCRIPT_DIR/server.py"
PLIST_NAME="com.chromepilot.server"
PLIST_FILE="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
LOG_DIR="$HOME/Library/Logs/chromepilot"
CHROME_APP="/Applications/Google Chrome.app"
CHROME_BIN="$CHROME_APP/Contents/MacOS/Google Chrome"

step=0
total_steps=5

step() {
  step=$((step + 1))
  echo ""
  echo -e "${BLUE}[$step/$total_steps]${NC} ${BOLD}$1${NC}"
}

ok() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

# ── Banner ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       ${CYAN}ChromePilot${NC} ${BOLD}Setup v1.0         ║${NC}"
echo -e "${BOLD}║   AI Agent 的 Chrome 驾驶舱           ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════╝${NC}"

# ── Step 1: 检查前置依赖 ──────────────────────────────────
step "检查环境依赖"

# Python
if command -v python3 &>/dev/null; then
  PY_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
  ok "Python3 已安装 ($PY_VERSION)"
else
  fail "未找到 Python3"
  echo "    请先安装: https://www.python.org/downloads/"
  exit 1
fi

# pip / aiohttp
if python3 -c "import aiohttp" &>/dev/null; then
  ok "aiohttp 已安装"
else
  info "安装 aiohttp ..."
  python3 -m pip install aiohttp --quiet --break-system-packages 2>/dev/null \
    || python3 -m pip install aiohttp --quiet 2>/dev/null \
    || pip3 install aiohttp --quiet 2>/dev/null
  if python3 -c "import aiohttp" &>/dev/null; then
    ok "aiohttp 安装成功"
  else
    fail "aiohttp 安装失败，请手动运行: pip3 install aiohttp"
    exit 1
  fi
fi

# Chrome
if [ -d "$CHROME_APP" ]; then
  ok "Chrome 已安装"
else
  fail "未找到 Google Chrome"
  echo "    请先安装: https://www.google.com/chrome/"
  exit 1
fi

# server.py
if [ -f "$SERVER_SCRIPT" ]; then
  ok "server.py 就绪 ($SERVER_SCRIPT)"
else
  fail "server.py 不存在: $SERVER_SCRIPT"
  exit 1
fi

# extension
if [ -f "$EXTENSION_DIR/manifest.json" ]; then
  ok "扩展目录就绪 ($EXTENSION_DIR)"
else
  fail "扩展目录无效: $EXTENSION_DIR"
  exit 1
fi

# ── Step 2: 配置 server 自启动 (LaunchAgent) ──────────────
step "配置 Server 开机自启"

mkdir -p "$LOG_DIR"

if [ -f "$PLIST_FILE" ]; then
  # 先停掉旧的
  launchctl unload "$PLIST_FILE" 2>/dev/null || true
  warn "已存在旧的 LaunchAgent，将覆盖更新"
fi

cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>$SERVER_SCRIPT</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/chromepilot.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/chromepilot-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
EOF

ok "LaunchAgent 已写入: $PLIST_FILE"

# 启动服务
launchctl load "$PLIST_FILE" 2>/dev/null || true
sleep 2

# 检查是否启动成功
if launchctl list | grep -q "$PLIST_NAME"; then
  PID=$(launchctl list | grep "$PLIST_NAME" | awk '{print $1}')
  if [ "$PID" != "-" ] && [ -n "$PID" ]; then
    ok "Server 已启动 (PID: $PID)"
  else
    # 可能是 TCC 权限问题
    ERROR=$(tail -1 "$LOG_DIR/chromepilot-error.log" 2>/dev/null)
    if echo "$ERROR" | grep -q "Operation not permitted"; then
      warn "Server 启动失败: macOS 安全限制"
      echo ""
      echo -e "    ${YELLOW}需要授予 Python 完全磁盘访问权限:${NC}"
      echo "    1. 打开 系统设置 → 隐私与安全性 → 完全磁盘访问权限"
      echo "    2. 点击 + 号，按 Cmd+Shift+G 输入: /usr/bin/python3"
      echo "    3. 添加并开启开关"
      echo "    4. 重新运行本脚本，或手动执行:"
      echo "       launchctl unload $PLIST_FILE"
      echo "       launchctl load $PLIST_FILE"
      echo ""
    else
      warn "Server 启动异常，查看日志: tail $LOG_DIR/chromepilot-error.log"
    fi
  fi
else
  warn "LaunchAgent 加载失败"
fi

# 验证 HTTP 端口
sleep 1
if curl -s http://127.0.0.1:8787/status >/dev/null 2>&1; then
  ok "Server HTTP 服务正常 (http://127.0.0.1:8787)"
else
  warn "Server HTTP 未响应，可能仍在启动中"
fi

# ── Step 3: 安装 Chrome 扩展 ─────────────────────────────
step "安装 Chrome 扩展"

# 检查 Chrome 是否运行中
CHROME_RUNNING=false
if pgrep -x "Google Chrome" >/dev/null 2>&1; then
  CHROME_RUNNING=true
fi

if [ "$CHROME_RUNNING" = true ]; then
  # Chrome 已运行，无法用 --load-extension，引导手动操作
  info "Chrome 正在运行，将打开扩展管理页面"
  echo ""
  echo -e "    ${BOLD}请在打开的页面中完成以下操作:${NC}"
  echo ""
  echo "    ① 开启右上角的「开发者模式」开关"
  echo "    ② 点击左上角「加载已解压的扩展程序」"
  echo "    ③ 选择以下目录:"
  echo -e "       ${CYAN}$EXTENSION_DIR${NC}"
  echo ""

  # 把路径复制到剪贴板
  echo -n "$EXTENSION_DIR" | pbcopy 2>/dev/null && \
    info "扩展目录路径已复制到剪贴板，直接粘贴即可"

  # 打开扩展管理页面
  open "https://goto-extensions-page.chromepilot.local" 2>/dev/null || true
  # 上面的会失败，用 AppleScript 作为 fallback
  osascript -e '
    tell application "Google Chrome"
      activate
      open location "chrome://extensions/"
    end tell
  ' 2>/dev/null || true

  echo ""
  echo -e "    完成后按 ${BOLD}回车${NC} 继续..."
  read -r
else
  # Chrome 未运行，可以用 --load-extension 直接加载
  info "首次启动 Chrome 并自动加载扩展..."
  "$CHROME_BIN" --load-extension="$EXTENSION_DIR" &>/dev/null &
  sleep 3
  ok "Chrome 已启动并加载 ChromePilot 扩展"
  info "扩展加载后，后续正常打开 Chrome 都会保留"
fi

# ── Step 4: 验证连接 ──────────────────────────────────────
step "验证连接状态"

# 等待扩展连接
MAX_WAIT=10
CONNECTED=false
for i in $(seq 1 $MAX_WAIT); do
  RESULT=$(curl -s http://127.0.0.1:8787/status 2>/dev/null || echo '{}')
  if echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get('connected') else 1)" 2>/dev/null; then
    CONNECTED=true
    break
  fi
  sleep 1
done

if [ "$CONNECTED" = true ]; then
  ok "扩展已连接到 Server"
  # 尝试列出标签页
  TAB_COUNT=$(python3 "$SCRIPT_DIR/cp.py" tabs --json 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "?")
  ok "检测到 $TAB_COUNT 个浏览器标签页"
else
  warn "扩展尚未连接，可能需要等待几秒"
  info "稍后可运行 python3 $SCRIPT_DIR/cp.py status 检查"
fi

# ── Step 5: 创建快捷命令 ──────────────────────────────────
step "配置快捷命令"

# 检查 shell 类型
SHELL_RC=""
if [ -n "$ZSH_VERSION" ] || [ "$(basename "$SHELL")" = "zsh" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ "$(basename "$SHELL")" = "bash" ]; then
  SHELL_RC="$HOME/.bash_profile"
fi

ALIAS_LINE="alias cp-pilot='python3 $SCRIPT_DIR/cp.py'"

if [ -n "$SHELL_RC" ]; then
  if [ -f "$SHELL_RC" ] && grep -q "cp-pilot" "$SHELL_RC" 2>/dev/null; then
    ok "快捷命令 cp-pilot 已存在"
  else
    echo "" >> "$SHELL_RC"
    echo "# ChromePilot CLI 快捷命令" >> "$SHELL_RC"
    echo "$ALIAS_LINE" >> "$SHELL_RC"
    ok "已添加快捷命令到 $SHELL_RC"
    info "新终端中可直接使用: cp-pilot status / cp-pilot tabs / ..."
  fi
else
  warn "无法确定 shell 配置文件，请手动添加:"
  echo "    $ALIAS_LINE"
fi

# ── 完成 ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ChromePilot 安装完成!${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}快速验证:${NC}"
echo "    python3 $SCRIPT_DIR/cp.py status"
echo ""
echo -e "  ${BOLD}常用命令:${NC}"
echo "    cp-pilot status          # 检查连接"
echo "    cp-pilot tabs            # 列出标签页"
echo "    cp-pilot eval 'expr'     # 执行 JS"
echo ""
echo -e "  ${BOLD}管理面板:${NC}"
echo "    点击 Chrome 工具栏中的 ChromePilot 图标"
echo ""
echo -e "  ${BOLD}日志位置:${NC}"
echo "    $LOG_DIR/chromepilot.log"
echo "    $LOG_DIR/chromepilot-error.log"
echo ""
echo -e "  ${BOLD}卸载:${NC}"
echo "    bash $SCRIPT_DIR/setup.sh --uninstall"
echo ""

# ── 卸载模式 ──────────────────────────────────────────────
if [ "${1:-}" = "--uninstall" ]; then
  echo ""
  echo -e "${YELLOW}${BOLD}卸载 ChromePilot ...${NC}"

  # 停止 LaunchAgent
  if [ -f "$PLIST_FILE" ]; then
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    rm -f "$PLIST_FILE"
    ok "LaunchAgent 已移除"
  fi

  # 移除 alias
  if [ -n "$SHELL_RC" ] && [ -f "$SHELL_RC" ]; then
    if grep -q "cp-pilot" "$SHELL_RC" 2>/dev/null; then
      # 用 sed 删除 alias 行和注释行
      sed -i '' '/# ChromePilot CLI/d' "$SHELL_RC" 2>/dev/null || true
      sed -i '' '/cp-pilot/d' "$SHELL_RC" 2>/dev/null || true
      ok "快捷命令已移除"
    fi
  fi

  echo ""
  echo -e "  ${BOLD}还需要手动操作:${NC}"
  echo "    1. 打开 chrome://extensions/ 移除 ChromePilot 扩展"
  echo "    2. (可选) 从 系统设置 中移除 python3 的完全磁盘访问权限"
  echo ""
  ok "卸载完成"
  exit 0
fi
