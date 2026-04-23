import type { PanelState } from "../types";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import "./OverviewPanel.scss";

interface OverviewPanelProps {
  state: PanelState;
}

export function OverviewPanel({ state }: OverviewPanelProps) {
  const activeTabs =
    state.tabs?.filter(
      (t) => t.features.network || t.features.console || t.features.intercept || t.features.proxy,
    ) || [];

  const totalNet = state.tabs?.reduce((s, t) => s + (t.networkCount || 0), 0) || 0;
  const totalCon = state.tabs?.reduce((s, t) => s + (t.consoleCount || 0), 0) || 0;
  const totalProxyHits =
    (state.globalProxy?.log?.length || 0) +
    (state.tabs?.reduce((s, t) => s + (t.proxy?.log?.length || 0), 0) || 0);

  return (
    <div className="overview-panel">
      {/* Connection card */}
      <Card title="连接状态">
        <div className="conn-body">
          <div
            className="conn-dot"
            style={{ background: state.connected ? "var(--green)" : "var(--red)" }}
          />
          <div>
            <div className="conn-label">{state.connected ? "Server Connected" : "Disconnected"}</div>
            <div className="conn-url">ws://127.0.0.1:8787/ws</div>
          </div>
        </div>
      </Card>

      {/* Active features */}
      {activeTabs.length > 0 || state.globalProxy?.active ? (
        <Card
          title="活跃功能"
          countText={(state.globalProxy?.active ? "全局代理 + " : "") + activeTabs.length + " 个标签页"}
        >
          {state.globalProxy?.active && (
            <div className="feature-row">
              <span className="feature-tab-id" style={{ color: "var(--green)" }}>
                GLOBAL
              </span>
              <span className="feature-tab-title">
                全局代理 · {(state.globalProxy.rules?.length || 0)} 条规则
                {state.globalProxy.paused ? " (已暂停)" : ""}
              </span>
              <span className="feature-pills">
                <span className="pill pill-prx">PRX {(state.globalProxy.log?.length || 0)}</span>
              </span>
            </div>
          )}

          {activeTabs.map((t) => {
            if (t.features.proxy && state.globalProxy?.active) return null;
            const bt = state.browserTabs?.find((b) => b.tabId === t.tabId);
            return (
              <div key={t.tabId} className="feature-row">
                <span className="feature-tab-id">#{t.tabId}</span>
                <span className="feature-tab-title" title={bt?.url || ""}>
                  {bt?.title || "Tab"}
                </span>
                <span className="feature-pills">
                  {t.features.network && (
                    <span className="pill pill-net">NET {t.networkCount || 0}</span>
                  )}
                  {t.features.console && (
                    <span className="pill pill-con">CON {t.consoleCount || 0}</span>
                  )}
                  {t.features.intercept && <span className="pill pill-int">INT</span>}
                  {t.features.proxy && !state.globalProxy?.active && (
                    <span className="pill pill-prx">PRX {t.proxy?.log?.length || 0}</span>
                  )}
                </span>
              </div>
            );
          })}
        </Card>
      ) : (
        <Card title="活跃功能">
          <EmptyState icon="~" text="暂无活跃的调试功能，通过 CLI 启动 net/console/proxy" />
        </Card>
      )}

      {/* Stats */}
      <Card title="统计">
        <div className="stats-grid">
          {[
            { val: totalNet, label: "网络请求", color: "var(--blue)" },
            { val: totalCon, label: "Console", color: "var(--orange)" },
            { val: totalProxyHits, label: "代理命中", color: "var(--green)" },
          ].map((s) => (
            <div key={s.label} className="stats-cell">
              <div className="stats-num" style={{ color: s.color }}>
                {s.val}
              </div>
              <div className="stats-label">{s.label}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
