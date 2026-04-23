import { useCallback, useState } from "react";
import { ruleMatchesUrl, timeAgo, truncate } from "../modules/utils";
import { ruleToWhistle, rulesToWhistle } from "../modules/whistle";
import type { PanelState, ProxyLogEntry, ProxyRule } from "../types";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { WhistleEditor } from "./WhistleEditor";
import "./ProxyPanel.scss";

interface ProxyPanelProps {
  state: PanelState;
  refresh: () => void;
}

const ACTION_ICONS: Record<string, string> = {
  mock: "\u{1F4E6}",
  block: "\u{1F6AB}",
  redirect: "\u21AA",
  delay: "\u23F1",
  header: "\u{1F4DD}",
  resHeader: "\u{1F4CB}",
};

function LogList({ entries }: { entries: ProxyLogEntry[] }) {
  if (entries.length === 0) {
    return <div style={{ color: "var(--text3)", fontSize: "12px", padding: "4px 0" }}>暂无命中</div>;
  }
  return (
    <>
      {entries.map((e, i) => (
        <div key={i} className="log-item">
          <span className="log-icon">{ACTION_ICONS[e.action || ""] || "\u2022"}</span>
          <div className="log-body">
            <div className="log-url" title={e.url || ""}>
              {(e.method || "?") + " " + truncate(e.url || "", 60)}
            </div>
            <div className="log-meta">
              {(e.detail || e.action || "") + " \u00B7 " + timeAgo(e.ts)}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function RuleList({ rules }: { rules: ProxyRule[] }) {
  if (rules.length === 0) {
    return <div style={{ color: "var(--text3)", fontSize: "12px", padding: "4px 0" }}>无规则</div>;
  }
  return (
    <>
      {rules.map((r, i) => {
        const wt = ruleToWhistle(r);
        return (
          <div key={i} className="rule-item" style={{ cursor: "default" }}>
            <span className={`rule-action action-${r.action || "mock"}`}>{r.action || "mock"}</span>
            <span className="rule-pattern" title={wt}>
              {wt}
            </span>
          </div>
        );
      })}
    </>
  );
}

export function ProxyPanel({ state, refresh }: ProxyPanelProps) {
  const [editingGlobal, setEditingGlobal] = useState<string | null>(null);
  const [editingPerTab, setEditingPerTab] = useState<string | null>(null);

  const activeTab = state.browserTabs?.find((t) => t.active);
  const gp = state.globalProxy;

  const handleGlobalSave = useCallback(
    async (text: string, rules: ProxyRule[]) => {
      if (gp?.active) {
        await chrome.runtime.sendMessage({ type: "proxyUpdateGlobalRules", rules, whistleText: text });
      } else {
        await chrome.runtime.sendMessage({ type: "proxyStartGlobal", rules, whistleText: text });
      }
      setEditingGlobal(null);
      refresh();
    },
    [gp?.active, refresh],
  );

  const handlePerTabSave = useCallback(
    async (text: string, rules: ProxyRule[]) => {
      if (!activeTab) return;
      const tabEntry = state.tabs?.find((t) => t.tabId === activeTab.tabId);
      const isPerTab = tabEntry?.proxy && !tabEntry.proxy._global;
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
      setEditingPerTab(null);
      refresh();
    },
    [activeTab, state.tabs, refresh],
  );

  // ── Current Tab Section ──
  const showCurrentTab =
    activeTab &&
    activeTab.url &&
    !activeTab.url.startsWith("chrome") &&
    !activeTab.url.startsWith("about:");

  // ── Other Per-Tab Proxies ──
  const otherPerTab =
    state.tabs?.filter(
      (t) => t.proxy && !t.proxy._global && t.tabId !== activeTab?.tabId,
    ) || [];

  return (
    <div className="proxy-panel">
      {/* Current Tab */}
      {showCurrentTab && activeTab && (
        <CurrentTabCard
          activeTab={activeTab}
          state={state}
          editingPerTab={editingPerTab}
          setEditingPerTab={setEditingPerTab}
          onSave={handlePerTabSave}
          refresh={refresh}
        />
      )}

      {/* Other Per-Tab */}
      {otherPerTab.length > 0 && (
        <Card title="其他标签页代理" countText={otherPerTab.length + " 个"}>
          {otherPerTab.map((entry) => {
            const bt = state.browserTabs?.find((b) => b.tabId === entry.tabId);
            return (
              <div key={entry.tabId} className="feature-row">
                <span className="feature-tab-id">#{entry.tabId}</span>
                <span className="feature-tab-title">{bt?.title || "Tab"}</span>
                <span style={{ fontSize: "11px", color: "var(--text3)", flexShrink: 0 }}>
                  {(entry.proxy?.rules?.length || 0)} 条规则
                </span>
                {activeTab && (
                  <button
                    className="btn"
                    style={{ padding: "2px 6px", fontSize: "10.5px", flexShrink: 0, marginLeft: "auto" }}
                    onClick={async () => {
                      const otherRules = entry.proxy?.rules || [];
                      const otherWhistle = entry.proxy?.whistleText || rulesToWhistle(otherRules);
                      await chrome.runtime.sendMessage({
                        type: "proxyStartTab",
                        tabId: activeTab.tabId,
                        rules: otherRules,
                        whistleText: otherWhistle,
                      });
                      refresh();
                    }}
                  >
                    复制到当前
                  </button>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {/* Global Proxy */}
      {gp && gp.active ? (
        <GlobalProxyActiveCard
          gp={gp}
          editingGlobal={editingGlobal}
          setEditingGlobal={setEditingGlobal}
          onSave={handleGlobalSave}
          refresh={refresh}
        />
      ) : (
        <GlobalProxyInactiveCard
          editingGlobal={editingGlobal}
          setEditingGlobal={setEditingGlobal}
          onSave={handleGlobalSave}
        />
      )}
    </div>
  );
}

// ── Sub-components ──

function CurrentTabCard({
  activeTab,
  state,
  editingPerTab,
  setEditingPerTab,
  onSave,
  refresh,
}: {
  activeTab: { tabId: number; url?: string };
  state: PanelState;
  editingPerTab: string | null;
  setEditingPerTab: (v: string | null) => void;
  onSave: (text: string, rules: ProxyRule[]) => void;
  refresh: () => void;
}) {
  const url = activeTab.url;
  const tabEntry = state.tabs?.find((t) => t.tabId === activeTab.tabId);
  const perTabProxy = tabEntry?.proxy;
  const isPerTab = perTabProxy && !perTabProxy._global;
  const perTabRules = isPerTab ? perTabProxy.rules || [] : [];
  const globalRules = state.globalProxy?.active && !state.globalProxy?.paused ? state.globalProxy.rules || [] : [];
  const matchingGlobal = globalRules.filter((r) => ruleMatchesUrl(r, url));
  const totalRules = perTabRules.length + matchingGlobal.length;

  let displayUrl: string;
  try {
    const u = new URL(url);
    displayUrl = u.hostname + u.pathname;
  } catch {
    displayUrl = url;
  }
  if (displayUrl.length > 55) displayUrl = displayUrl.slice(0, 55) + "...";

  return (
    <Card
      title="当前标签页"
      countText={totalRules ? totalRules + " 条规则" : ""}
      headerExtra={
        <button
          className="btn"
          style={{ padding: "2px 8px", fontSize: "10.5px" }}
          onClick={() => setEditingPerTab(editingPerTab !== null ? null : (isPerTab ? perTabProxy?.whistleText || rulesToWhistle(perTabRules) : ""))}
        >
          {editingPerTab !== null ? "收起" : "编辑"}
        </button>
      }
    >
      <div className="url-row">
        <span className="url-text" title={url}>
          {"\uD83C\uDF10 " + displayUrl}
        </span>
      </div>

      {editingPerTab !== null ? (
        <WhistleEditor
          initialValue={editingPerTab}
          saveLabel={isPerTab ? "保存" : "启动代理"}
          onSave={onSave}
          onCancel={() => setEditingPerTab(null)}
        />
      ) : (
        <>
          {totalRules === 0 ? (
            <div style={{ color: "var(--text3)", fontSize: "12px", padding: "4px 0" }}>
              无代理规则 — 点击编辑添加
            </div>
          ) : (
            <>
              {perTabRules.map((r, i) => (
                <div key={"pt" + i} className="rule-item" style={{ cursor: "default" }}>
                  <span className={`rule-action action-${r.action || "mock"}`}>{r.action || "mock"}</span>
                  <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", fontWeight: 500, flexShrink: 0, background: "#fef3c7", color: "#92400e" }}>
                    标签
                  </span>
                  <span className="rule-pattern" title={ruleToWhistle(r)}>
                    {ruleToWhistle(r)}
                  </span>
                </div>
              ))}
              {matchingGlobal.map((r, i) => (
                <div key={"gl" + i} className="rule-item" style={{ cursor: "default" }}>
                  <span className={`rule-action action-${r.action || "mock"}`}>{r.action || "mock"}</span>
                  <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", fontWeight: 500, flexShrink: 0, background: "#dbeafe", color: "#1d4ed8" }}>
                    全局
                  </span>
                  <span className="rule-pattern" title={ruleToWhistle(r)}>
                    {ruleToWhistle(r)}
                  </span>
                </div>
              ))}
            </>
          )}

          {isPerTab && perTabProxy && (
            <>
              {perTabProxy.log && perTabProxy.log.length > 0 && (
                <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--bg)" }}>
                  <div style={{ fontSize: "11px", color: "var(--text3)", marginBottom: "4px" }}>
                    命中日志 · {perTabProxy.log.length} 次
                  </div>
                  <LogList entries={perTabProxy.log.slice(-10).reverse()} />
                </div>
              )}
              <div className="btn-row">
                <button
                  className="btn"
                  onClick={async () => {
                    await chrome.runtime.sendMessage({ type: "proxyClearLog", tabId: activeTab.tabId });
                    refresh();
                  }}
                >
                  清空日志
                </button>
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    await chrome.runtime.sendMessage({ type: "proxyStop", tabId: activeTab.tabId });
                    refresh();
                  }}
                >
                  停止
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function GlobalProxyActiveCard({
  gp,
  editingGlobal,
  setEditingGlobal,
  onSave,
  refresh,
}: {
  gp: NonNullable<PanelState["globalProxy"]>;
  editingGlobal: string | null;
  setEditingGlobal: (v: string | null) => void;
  onSave: (text: string, rules: ProxyRule[]) => void;
  refresh: () => void;
}) {
  const isPaused = !!gp.paused;
  const whistleText = gp.whistleText || rulesToWhistle(gp.rules || []);
  const log = gp.log || [];

  return (
    <>
      {/* Status */}
      <Card title="全局代理" countText={(gp.tabCount || 0) + " 个标签页"}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "2px 0" }}>
          <label className="toggle">
            <input
              type="checkbox"
              checked={!isPaused}
              onChange={async () => {
                if (isPaused) {
                  await chrome.runtime.sendMessage({ type: "proxyResumeGlobal" });
                } else {
                  await chrome.runtime.sendMessage({ type: "proxyPauseGlobal" });
                }
                refresh();
              }}
            />
            <span className="toggle-slider" />
          </label>
          <div
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: isPaused ? "var(--orange)" : "var(--green)",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: "12px", color: "var(--text2)", flex: 1 }}>
            {isPaused
              ? `已暂停 · ${gp.rules?.length || 0} 条规则`
              : `运行中 · ${gp.rules?.length || 0} 条规则 · ${gp.tabCount || 0} 个标签页`}
          </span>
        </div>
      </Card>

      {/* Rules */}
      <Card
        title="全局规则"
        countText={(gp.rules?.length || 0) + " 条"}
        headerExtra={
          <button
            className="btn"
            style={{ padding: "2px 8px", fontSize: "10.5px" }}
            onClick={() => setEditingGlobal(editingGlobal !== null ? null : whistleText)}
          >
            {editingGlobal !== null ? "收起" : "编辑"}
          </button>
        }
      >
        {editingGlobal !== null ? (
          <WhistleEditor initialValue={editingGlobal} onSave={onSave} onCancel={() => setEditingGlobal(null)} />
        ) : (
          <RuleList rules={gp.rules || []} />
        )}
      </Card>

      {/* Log */}
      <Card title="全局命中日志" countText={log.length + " 次"}>
        <LogList entries={log.slice(0, 30)} />
      </Card>

      {/* Controls */}
      <div className="btn-row">
        <button
          className="btn"
          onClick={async () => {
            await chrome.runtime.sendMessage({ type: "proxyGlobalClearLog" });
            refresh();
          }}
        >
          清空日志
        </button>
        <button
          className="btn btn-danger"
          onClick={async () => {
            await chrome.runtime.sendMessage({ type: "proxyStopGlobal" });
            refresh();
          }}
        >
          停止全局代理
        </button>
      </div>
    </>
  );
}

function GlobalProxyInactiveCard({
  editingGlobal,
  setEditingGlobal,
  onSave,
}: {
  editingGlobal: string | null;
  setEditingGlobal: (v: string | null) => void;
  onSave: (text: string, rules: ProxyRule[]) => void;
}) {
  return (
    <Card title="全局代理">
      {editingGlobal === null ? (
        <>
          <EmptyState
            icon="\u21CC"
            text="全局代理未启动，代理规则会自动应用到所有标签页"
          />
          <div className="btn-row" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => setEditingGlobal("")}>
              配置并启动
            </button>
          </div>
        </>
      ) : (
        <WhistleEditor
          initialValue={editingGlobal}
          saveLabel="启动全局代理"
          onSave={onSave}
          onCancel={() => setEditingGlobal(null)}
        />
      )}
    </Card>
  );
}
