// @ts-nocheck
import { esc, ruleMatchesUrl, timeAgo, truncate } from "./modules/utils";
import { parseWhistleRules, rulesToWhistle, ruleToWhistle } from "./modules/whistle";

// ─────────────────────────────────────────────────────────
// ChromePilot Popup — Module System
// To add a new feature tab, just call registerModule({...})
// ─────────────────────────────────────────────────────────
const _modules = [];
let _activeModule = null;
let _state = { connected: false, tabs: [], browserTabs: [] };
let _refreshTimer = null;
let _selectedTabId = null;
let _lastStateHash = "";
let _editingWhistle = null; // whistle text in edit mode, null = view mode
let _editingPerTabWhistle = null; // per-tab whistle text in edit mode

function registerModule(mod) {
  // mod: { id, label, icon, badge?(), init?(), render(container, state), destroy?() }
  _modules.push(mod);
}

function switchModule(id) {
  const mod = _modules.find((m) => m.id === id);
  if (!mod) return;
  if (_activeModule && _activeModule.destroy) _activeModule.destroy();
  _activeModule = mod;

  // Update tab bar
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.id === id);
  });

  // Render
  const main = document.getElementById("mainContent");
  main.innerHTML = "";
  if (mod.init) mod.init();
  mod.render(main, _state);
}

function refreshUI() {
  if (!_activeModule) return;
  // Update badges
  _modules.forEach((mod) => {
    if (mod.badge) {
      const el = document.querySelector(`.tab-btn[data-id="${mod.id}"] .tab-badge`);
      if (el) {
        const val = mod.badge(_state);
        el.textContent = val;
        el.style.display = val ? "" : "none";
      }
    }
  });
  // Re-render active panel
  const main = document.getElementById("mainContent");
  main.innerHTML = "";
  _activeModule.render(main, _state);
}

function buildTabBar() {
  const bar = document.getElementById("tabBar");
  bar.innerHTML = "";
  _modules.forEach((mod) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn";
    btn.dataset.id = mod.id;
    const badgeVal = mod.badge ? mod.badge(_state) : null;
    btn.innerHTML =
      '<span class="tab-icon">' +
      mod.icon +
      "</span>" +
      mod.label +
      '<span class="tab-badge" style="display:' +
      (badgeVal ? "" : "none") +
      '">' +
      (badgeVal || "") +
      "</span>";
    btn.onclick = () => switchModule(mod.id);
    bar.appendChild(btn);
  });
}

// ─────────────────────────────────────────────────────────
// Data Fetching
// ─────────────────────────────────────────────────────────
async function fetchState() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "getState" });
    if (!res) return;
    const hash = JSON.stringify(res);
    if (hash === _lastStateHash) return; // data unchanged, skip render
    _lastStateHash = hash;
    _state = res;
    updateConnectionUI();
    refreshUI();
  } catch (e) {
    const fallback = JSON.stringify({ connected: false });
    if (fallback === _lastStateHash) return;
    _lastStateHash = fallback;
    _state.connected = false;
    updateConnectionUI();
    refreshUI();
  }
}

function updateConnectionUI() {
  const dot = document.getElementById("statusDot");
  const txt = document.getElementById("statusText");
  if (_state.connected) {
    dot.classList.add("on");
    txt.textContent = "Connected";
  } else {
    dot.classList.remove("on");
    txt.textContent = "Disconnected";
  }
  document.getElementById("footerRight").textContent = (_state.browserTabs?.length || 0) + " tabs";
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
function createCard(title, countText) {
  const card = document.createElement("div");
  card.className = "card";
  const header = document.createElement("div");
  header.className = "card-header";
  header.innerHTML =
    '<span class="card-title">' +
    title +
    "</span>" +
    (countText ? '<span class="card-count">' + countText + "</span>" : "");
  card.appendChild(header);
  return card;
}

function createBtn(text, cls, onclick) {
  const btn = document.createElement("button");
  btn.className = cls;
  btn.textContent = text;
  btn.onclick = onclick;
  return btn;
}

// Utilities and Whistle conversion moved to ./modules/*.ts

function _renderWhistleEditor(parent, onSave, saveLabel, stateAccessor) {
  const acc = stateAccessor || {
    get() {
      return _editingWhistle;
    },
    set(v) {
      _editingWhistle = v;
    },
    reset() {
      _editingWhistle = null;
    },
  };

  const panel = document.createElement("div");
  panel.className = "rule-detail-panel";

  const textarea = document.createElement("textarea");
  textarea.className = "rule-editor";
  textarea.value = acc.get() || "";
  textarea.spellcheck = false;
  textarea.placeholder =
    '# Whistle 格式，每行一条规则\n# 重定向\nhttps://source.com https://target.com\ndomain.com http://127.0.0.1:3000\n^domain.com/*** http://target/$1\nhost://target.host domain1 domain2\n127.0.0.1:6001 domain.com\n# 请求/响应头\ndomain.com reqHeaders://(X-Env: test)\n# 拦截控制\ndomain.com block://\ndomain.com mock://200 {"data":"test"}\ndomain.com delay://2000\ndomain.com disable://';
  textarea.style.height =
    Math.min(340, Math.max(160, (acc.get() || "").split("\n").length * 17 + 16)) + "px";
  textarea.oninput = () => {
    acc.set(textarea.value);
  };
  textarea.onkeydown = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = textarea.selectionStart,
        end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, s) + "  " + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = s + 2;
      acc.set(textarea.value);
    }
  };
  panel.appendChild(textarea);

  const hint = document.createElement("div");
  hint.className = "rule-editor-hint";
  hint.textContent =
    "格式: domain target | ^domain/*** target/$1 | host://target domain | IP domain | reqHeaders:// | block:// | mock://STATUS | delay://MS";

  const actionsRow = document.createElement("div");
  actionsRow.className = "rule-editor-actions";

  const btnCancel = createBtn("取消", "btn", () => {
    acc.reset();
    refreshUI();
  });
  const btnSave = createBtn(saveLabel || "保存", "btn btn-primary", async () => {
    try {
      const currentText = acc.get();
      const newRules = parseWhistleRules(currentText);
      if (newRules.length === 0 && currentText.trim().replace(/^#.*$/gm, "").trim()) {
        throw new Error("没有解析出有效规则，请检查格式");
      }
      await onSave(currentText, newRules);
      acc.reset();
      fetchState();
    } catch (err) {
      hint.textContent = "错误: " + err.message;
      hint.className = "rule-editor-hint error";
    }
  });

  actionsRow.append(hint, btnCancel, btnSave);
  panel.appendChild(actionsRow);
  parent.appendChild(panel);
}

function _renderRuleList(parent, rules) {
  if (rules.length === 0) {
    const noRule = document.createElement("div");
    noRule.style.cssText = "color:var(--text3);font-size:12px;padding:4px 0";
    noRule.textContent = "无规则";
    parent.appendChild(noRule);
    return;
  }
  rules.forEach((r) => {
    const wt = ruleToWhistle(r);
    const row = document.createElement("div");
    row.className = "rule-item";
    row.style.cursor = "default";

    const actionSpan = document.createElement("span");
    actionSpan.className = "rule-action action-" + (r.action || "mock");
    actionSpan.textContent = r.action || "mock";

    const textSpan = document.createElement("span");
    textSpan.className = "rule-pattern";
    textSpan.textContent = wt;
    textSpan.title = wt;

    row.append(actionSpan, textSpan);
    parent.appendChild(row);
  });
}

function _renderLog(parent, logEntries) {
  if (logEntries.length === 0) {
    const noLog = document.createElement("div");
    noLog.style.cssText = "color:var(--text3);font-size:12px;padding:4px 0";
    noLog.textContent = "暂无命中";
    parent.appendChild(noLog);
    return;
  }
  const ACTION_ICONS = {
    mock: "\u{1F4E6}",
    block: "\u{1F6AB}",
    redirect: "\u21AA",
    delay: "\u23F1",
    header: "\u{1F4DD}",
    resHeader: "\u{1F4CB}",
  };
  logEntries.forEach((e) => {
    const row = document.createElement("div");
    row.className = "log-item";

    const iconSpan = document.createElement("span");
    iconSpan.className = "log-icon";
    iconSpan.textContent = ACTION_ICONS[e.action] || "\u2022";

    const body = document.createElement("div");
    body.className = "log-body";

    const urlDiv = document.createElement("div");
    urlDiv.className = "log-url";
    urlDiv.title = e.url || "";
    urlDiv.textContent = (e.method || "?") + " " + truncate(e.url || "", 60);

    const metaDiv = document.createElement("div");
    metaDiv.className = "log-meta";
    metaDiv.textContent = (e.detail || e.action || "") + " \u00B7 " + timeAgo(e.ts);

    body.append(urlDiv, metaDiv);
    row.append(iconSpan, body);
    parent.appendChild(row);
  });
}

// ─────────────────────────────────────────────────────────
// Module: Overview
// ─────────────────────────────────────────────────────────
registerModule({
  id: "overview",
  label: "概览",
  icon: "◉",

  render(container, state) {
    // Connection card
    const connCard = createCard("连接状态");
    const connBody = document.createElement("div");
    connBody.style.cssText = "display:flex;align-items:center;gap:12px;padding:4px 0";
    const bigDot = document.createElement("div");
    bigDot.style.cssText =
      "width:12px;height:12px;border-radius:50%;background:" +
      (state.connected ? "var(--green)" : "var(--red)");
    const connText = document.createElement("div");
    const connLabel = document.createElement("div");
    connLabel.style.cssText = "font-weight:600;font-size:13px";
    connLabel.textContent = state.connected ? "Server Connected" : "Disconnected";
    const connUrl = document.createElement("div");
    connUrl.style.cssText = "font-size:11px;color:var(--text3)";
    connUrl.textContent = "ws://127.0.0.1:8787/ws";
    connText.append(connLabel, connUrl);
    connBody.append(bigDot, connText);
    connCard.appendChild(connBody);
    container.appendChild(connCard);

    // Active features
    const activeTabs =
      state.tabs?.filter(
        (t) => t.features.network || t.features.console || t.features.intercept || t.features.proxy,
      ) || [];

    if (activeTabs.length > 0 || state.globalProxy?.active) {
      const featCard = createCard(
        "活跃功能",
        (state.globalProxy?.active ? "全局代理 + " : "") + activeTabs.length + " 个标签页",
      );

      if (state.globalProxy?.active) {
        const row = document.createElement("div");
        row.className = "feature-row";
        const idSpan = document.createElement("span");
        idSpan.className = "feature-tab-id";
        idSpan.textContent = "GLOBAL";
        idSpan.style.color = "var(--green)";
        const titleSpan = document.createElement("span");
        titleSpan.className = "feature-tab-title";
        titleSpan.textContent =
          "全局代理 · " +
          (state.globalProxy.rules?.length || 0) +
          " 条规则" +
          (state.globalProxy.paused ? " (已暂停)" : "");
        const pills = document.createElement("span");
        pills.className = "feature-pills";
        const p = document.createElement("span");
        p.className = "pill pill-prx";
        p.textContent = "PRX " + (state.globalProxy.log?.length || 0);
        pills.appendChild(p);
        row.append(idSpan, titleSpan, pills);
        featCard.appendChild(row);
      }

      activeTabs.forEach((t) => {
        if (t.features.proxy && state.globalProxy?.active) return; // skip global proxy tabs in per-tab list
        const row = document.createElement("div");
        row.className = "feature-row";
        const bt = state.browserTabs?.find((b) => b.tabId === t.tabId);
        const title = bt ? bt.title : "Tab";

        const idSpan = document.createElement("span");
        idSpan.className = "feature-tab-id";
        idSpan.textContent = "#" + t.tabId;

        const titleSpan = document.createElement("span");
        titleSpan.className = "feature-tab-title";
        titleSpan.title = bt?.url || "";
        titleSpan.textContent = title;

        const pills = document.createElement("span");
        pills.className = "feature-pills";
        if (t.features.network) {
          const p = document.createElement("span");
          p.className = "pill pill-net";
          p.textContent = "NET " + (t.networkCount || 0);
          pills.appendChild(p);
        }
        if (t.features.console) {
          const p = document.createElement("span");
          p.className = "pill pill-con";
          p.textContent = "CON " + (t.consoleCount || 0);
          pills.appendChild(p);
        }
        if (t.features.intercept) {
          const p = document.createElement("span");
          p.className = "pill pill-int";
          p.textContent = "INT";
          pills.appendChild(p);
        }
        if (t.features.proxy && !state.globalProxy?.active) {
          const p = document.createElement("span");
          p.className = "pill pill-prx";
          p.textContent = "PRX " + (t.proxy?.log?.length || 0);
          pills.appendChild(p);
        }

        row.append(idSpan, titleSpan, pills);
        featCard.appendChild(row);
      });
      container.appendChild(featCard);
    } else {
      const emptyCard = createCard("活跃功能");
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "empty";
      const emptyIcon = document.createElement("div");
      emptyIcon.className = "empty-icon";
      emptyIcon.textContent = "~";
      const emptyText = document.createElement("div");
      emptyText.className = "empty-text";
      emptyText.textContent = "暂无活跃的调试功能，通过 CLI 启动 net/console/proxy";
      emptyDiv.append(emptyIcon, emptyText);
      emptyCard.appendChild(emptyDiv);
      container.appendChild(emptyCard);
    }

    // Quick stats
    const statsCard = createCard("统计");
    const totalNet = state.tabs?.reduce((s, t) => s + (t.networkCount || 0), 0) || 0;
    const totalCon = state.tabs?.reduce((s, t) => s + (t.consoleCount || 0), 0) || 0;
    const totalProxyHits =
      (state.globalProxy?.log?.length || 0) +
      (state.tabs?.reduce((s, t) => s + (t.proxy?.log?.length || 0), 0) || 0);

    const grid = document.createElement("div");
    grid.style.cssText =
      "display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;padding:4px 0";

    const stats = [
      { val: totalNet, label: "网络请求", color: "var(--blue)" },
      { val: totalCon, label: "Console", color: "var(--orange)" },
      { val: totalProxyHits, label: "代理命中", color: "var(--green)" },
    ];
    stats.forEach((s) => {
      const cell = document.createElement("div");
      const num = document.createElement("div");
      num.style.cssText = "font-size:20px;font-weight:700;color:" + s.color;
      num.textContent = s.val;
      const lbl = document.createElement("div");
      lbl.style.cssText = "font-size:11px;color:var(--text3)";
      lbl.textContent = s.label;
      cell.append(num, lbl);
      grid.appendChild(cell);
    });
    statsCard.appendChild(grid);
    container.appendChild(statsCard);
  },
});

// ─────────────────────────────────────────────────────────
// Module: Proxy (Global + Per-Tab + Active Tab View)
// ─────────────────────────────────────────────────────────
registerModule({
  id: "proxy",
  label: "代理",
  icon: "⇌",
  badge(state) {
    if (state.globalProxy?.active) return state.globalProxy.tabCount || "\u2713";
    const active = state.tabs?.filter((t) => t.features.proxy).length || 0;
    return active || null;
  },

  render(container, state) {
    const gp = state.globalProxy;
    const activeTab = state.browserTabs?.find((t) => t.active);
    const perTabAcc = {
      get() {
        return _editingPerTabWhistle;
      },
      set(v) {
        _editingPerTabWhistle = v;
      },
      reset() {
        _editingPerTabWhistle = null;
      },
    };

    // ── Current Tab — unified rules + editor + log ─────
    if (
      activeTab &&
      activeTab.url &&
      !activeTab.url.startsWith("chrome") &&
      !activeTab.url.startsWith("about:")
    ) {
      const url = activeTab.url;
      const tabEntry = state.tabs?.find((t) => t.tabId === activeTab.tabId);
      const perTabProxy = tabEntry?.proxy;
      const isPerTab = perTabProxy && !perTabProxy._global;
      const perTabRules = isPerTab ? perTabProxy.rules || [] : [];

      // Matching global rules
      const globalRules = gp?.active && !gp?.paused ? gp.rules || [] : [];
      const matchingGlobal = globalRules.filter((r) => ruleMatchesUrl(r, url));

      const totalRules = perTabRules.length + matchingGlobal.length;

      let displayUrl;
      try {
        const u = new URL(url);
        displayUrl = u.hostname + u.pathname;
      } catch {
        displayUrl = url;
      }
      if (displayUrl.length > 55) displayUrl = displayUrl.slice(0, 55) + "...";

      const card = createCard("当前标签页", totalRules ? totalRules + " 条规则" : "");

      // Edit button in card header
      const editBtn = createBtn(_editingPerTabWhistle !== null ? "收起" : "编辑", "btn", () => {
        if (_editingPerTabWhistle !== null) {
          _editingPerTabWhistle = null;
        } else {
          _editingPerTabWhistle = isPerTab
            ? perTabProxy.whistleText || rulesToWhistle(perTabRules)
            : "";
        }
        refreshUI();
      });
      editBtn.style.cssText = "padding:2px 8px;font-size:10.5px";
      card.querySelector(".card-header").appendChild(editBtn);

      // Tab URL
      const urlRow = document.createElement("div");
      urlRow.style.cssText =
        "display:flex;align-items:center;gap:6px;padding:2px 0 8px;border-bottom:1px solid var(--bg);margin-bottom:6px";
      const urlText = document.createElement("span");
      urlText.style.cssText =
        'font-size:12px;color:var(--text);font-family:"SF Mono",Monaco,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      urlText.textContent = "\uD83C\uDF10 " + displayUrl;
      urlText.title = url;
      urlRow.appendChild(urlText);
      card.appendChild(urlRow);

      if (_editingPerTabWhistle !== null) {
        // ── Editor mode ──
        _renderWhistleEditor(
          card,
          async (text, rules) => {
            if (isPerTab) {
              await chrome.runtime.sendMessage({
                type: "proxyUpdateRules",
                tabId: activeTab.tabId,
                rules,
                whistleText: text,
              });
            } else {
              await chrome.runtime.sendMessage({
                type: "proxyStartTab",
                tabId: activeTab.tabId,
                rules,
                whistleText: text,
              });
            }
            _editingPerTabWhistle = null;
          },
          isPerTab ? "保存" : "启动代理",
          perTabAcc,
        );
      } else {
        // ── Display mode ──
        if (totalRules === 0) {
          const noRule = document.createElement("div");
          noRule.style.cssText = "color:var(--text3);font-size:12px;padding:4px 0";
          noRule.textContent = "无代理规则 — 点击编辑添加";
          card.appendChild(noRule);
        } else {
          // Show per-tab rules first, then matching global
          const allRules = [
            ...perTabRules.map((r) => ({ rule: r, source: "标签" })),
            ...matchingGlobal.map((r) => ({ rule: r, source: "全局" })),
          ];
          allRules.forEach(({ rule, source }) => {
            const row = document.createElement("div");
            row.className = "rule-item";
            row.style.cursor = "default";

            const actionSpan = document.createElement("span");
            actionSpan.className = "rule-action action-" + (rule.action || "mock");
            actionSpan.textContent = rule.action || "mock";

            const sourceSpan = document.createElement("span");
            sourceSpan.style.cssText =
              "font-size:10px;padding:1px 5px;border-radius:3px;font-weight:500;flex-shrink:0;" +
              (source === "全局"
                ? "background:#dbeafe;color:#1d4ed8"
                : "background:#fef3c7;color:#92400e");
            sourceSpan.textContent = source;

            const textSpan = document.createElement("span");
            textSpan.className = "rule-pattern";
            const wt = ruleToWhistle(rule);
            textSpan.textContent = wt;
            textSpan.title = wt;

            row.append(actionSpan, sourceSpan, textSpan);
            card.appendChild(row);
          });
        }

        // Per-tab hit log
        if (isPerTab) {
          const ptLog = perTabProxy.log || [];
          if (ptLog.length > 0) {
            const logSec = document.createElement("div");
            logSec.style.cssText = "margin-top:8px;padding-top:8px;border-top:1px solid var(--bg)";
            const logTitle = document.createElement("div");
            logTitle.style.cssText = "font-size:11px;color:var(--text3);margin-bottom:4px";
            logTitle.textContent = "命中日志 \u00B7 " + ptLog.length + " 次";
            logSec.appendChild(logTitle);
            _renderLog(logSec, ptLog.slice(-10).reverse());
            card.appendChild(logSec);
          }

          // Controls
          const ptBtnRow = document.createElement("div");
          ptBtnRow.className = "btn-row";
          ptBtnRow.append(
            createBtn("清空日志", "btn", async () => {
              await chrome.runtime.sendMessage({ type: "proxyClearLog", tabId: activeTab.tabId });
              fetchState();
            }),
            createBtn("停止", "btn btn-danger", async () => {
              await chrome.runtime.sendMessage({ type: "proxyStop", tabId: activeTab.tabId });
              fetchState();
            }),
          );
          card.appendChild(ptBtnRow);
        }
      }

      container.appendChild(card);
    }

    // ── Other Per-Tab Proxies (with copy button) ─────
    const otherPerTab = (state.tabs || []).filter(
      (t) => t.proxy && !t.proxy._global && t.tabId !== activeTab?.tabId,
    );
    if (otherPerTab.length > 0) {
      const otherCard = createCard("其他标签页代理", otherPerTab.length + " 个");
      otherPerTab.forEach((entry) => {
        const bt = state.browserTabs?.find((b) => b.tabId === entry.tabId);
        const row = document.createElement("div");
        row.className = "feature-row";

        const idSpan = document.createElement("span");
        idSpan.className = "feature-tab-id";
        idSpan.textContent = "#" + entry.tabId;

        const titleSpan = document.createElement("span");
        titleSpan.className = "feature-tab-title";
        titleSpan.textContent = bt?.title || "Tab";
        titleSpan.title = bt?.url || "";

        const countSpan = document.createElement("span");
        countSpan.style.cssText = "font-size:11px;color:var(--text3);flex-shrink:0";
        countSpan.textContent = (entry.proxy.rules?.length || 0) + " 条规则";

        const copyBtn = createBtn("复制到当前", "btn", async () => {
          if (!activeTab) return;
          const otherRules = entry.proxy.rules || [];
          const otherWhistle = entry.proxy.whistleText || rulesToWhistle(otherRules);
          await chrome.runtime.sendMessage({
            type: "proxyStartTab",
            tabId: activeTab.tabId,
            rules: otherRules,
            whistleText: otherWhistle,
          });
          fetchState();
        });
        copyBtn.style.cssText = "padding:2px 6px;font-size:10.5px;flex-shrink:0;margin-left:auto";

        row.append(idSpan, titleSpan, countSpan, copyBtn);
        otherCard.appendChild(row);
      });
      container.appendChild(otherCard);
    }

    // ── Global Proxy Section ───────────────────────────
    if (gp && gp.active) {
      // ── Global proxy active ──────────────────────────
      const isPaused = !!gp.paused;

      // Status card with toggle
      const statusCard = createCard("全局代理", gp.tabCount + " 个标签页");

      const statusRow = document.createElement("div");
      statusRow.style.cssText = "display:flex;align-items:center;gap:10px;padding:2px 0";

      // Toggle switch
      const toggle = document.createElement("label");
      toggle.className = "toggle";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !isPaused;
      checkbox.onchange = async () => {
        checkbox.disabled = true;
        if (checkbox.checked) {
          await chrome.runtime.sendMessage({ type: "proxyResumeGlobal" });
        } else {
          await chrome.runtime.sendMessage({ type: "proxyPauseGlobal" });
        }
        fetchState();
      };
      const slider = document.createElement("span");
      slider.className = "toggle-slider";
      toggle.append(checkbox, slider);

      const dot = document.createElement("div");
      dot.style.cssText =
        "width:10px;height:10px;border-radius:50%;background:" +
        (isPaused ? "var(--orange)" : "var(--green)") +
        ";flex-shrink:0";
      const statusText = document.createElement("span");
      statusText.style.cssText = "font-size:12px;color:var(--text2);flex:1";
      statusText.textContent = isPaused
        ? "已暂停 \u00B7 " + (gp.rules?.length || 0) + " 条规则"
        : "运行中 \u00B7 " +
          (gp.rules?.length || 0) +
          " 条规则 \u00B7 " +
          (gp.tabCount || 0) +
          " 个标签页";

      statusRow.append(toggle, dot, statusText);
      statusCard.appendChild(statusRow);
      container.appendChild(statusCard);

      // Rules card
      const whistleText = gp.whistleText || rulesToWhistle(gp.rules || []);
      const rulesCard = createCard("全局规则", (gp.rules?.length || 0) + " 条");

      const editBtn = createBtn(_editingWhistle !== null ? "收起" : "编辑", "btn", () => {
        _editingWhistle = _editingWhistle !== null ? null : whistleText;
        refreshUI();
      });
      editBtn.style.cssText = "padding:2px 8px;font-size:10.5px";
      rulesCard.querySelector(".card-header").appendChild(editBtn);

      if (_editingWhistle !== null) {
        _renderWhistleEditor(rulesCard, async (text, rules) => {
          await chrome.runtime.sendMessage({
            type: "proxyUpdateGlobalRules",
            rules,
            whistleText: text,
          });
        });
      } else {
        _renderRuleList(rulesCard, gp.rules || []);
      }
      container.appendChild(rulesCard);

      // Log card
      const log = gp.log || [];
      const recentLog = log.slice(0, 30);
      const logCard = createCard("全局命中日志", log.length + " 次");
      _renderLog(logCard, recentLog);
      container.appendChild(logCard);

      // Controls
      const btnRow = document.createElement("div");
      btnRow.className = "btn-row";
      const btnClear = createBtn("清空日志", "btn", async () => {
        await chrome.runtime.sendMessage({ type: "proxyGlobalClearLog" });
        fetchState();
      });
      const btnStop = createBtn("停止全局代理", "btn btn-danger", async () => {
        await chrome.runtime.sendMessage({ type: "proxyStopGlobal" });
        fetchState();
      });
      btnRow.append(btnClear, btnStop);
      container.appendChild(btnRow);
    } else {
      // ── No global proxy active ───────────────────────
      const card = createCard("全局代理");

      if (_editingWhistle === null) {
        // Empty state with start option
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "empty";
        const emptyIcon = document.createElement("div");
        emptyIcon.className = "empty-icon";
        emptyIcon.textContent = "\u21CC";
        const emptyText = document.createElement("div");
        emptyText.className = "empty-text";
        emptyText.textContent = "全局代理未启动，代理规则会自动应用到所有标签页";
        emptyDiv.append(emptyIcon, emptyText);
        card.appendChild(emptyDiv);

        const btnRow = document.createElement("div");
        btnRow.className = "btn-row";
        btnRow.style.justifyContent = "center";
        const btnStart = createBtn("配置并启动", "btn btn-primary", () => {
          _editingWhistle = "";
          refreshUI();
        });
        btnRow.appendChild(btnStart);
        card.appendChild(btnRow);
      } else {
        // Show editor to enter rules and start
        _renderWhistleEditor(
          card,
          async (text, rules) => {
            await chrome.runtime.sendMessage({
              type: "proxyStartGlobal",
              rules,
              whistleText: text,
            });
          },
          "启动全局代理",
        );
      }
      container.appendChild(card);
    }
  },
});

// ─────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────
buildTabBar();
switchModule("overview");
fetchState();
_refreshTimer = setInterval(fetchState, 1500);
