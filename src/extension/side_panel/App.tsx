import { useEffect, useMemo, useState } from "react";
import { usePanelState } from "./hooks/usePanelState";
import type { TabId } from "./types";
import { CommandsPanel } from "./components/CommandsPanel";
import { OverviewPanel } from "./components/OverviewPanel";
import { ProxyPanel } from "./components/ProxyPanel";
import { TabBar } from "./components/TabBar";

const TABS = [
  { id: "overview" as TabId, label: "概览", icon: "\u25CE" },
  { id: "proxy" as TabId, label: "代理", icon: "\u21CC" },
  { id: "commands" as TabId, label: "指令", icon: "\u26A1" },
];

const ACTIVE_MODULE_STORAGE = "chromepilot.sidePanel.activeModule";

async function readSavedActiveModuleId(): Promise<TabId | null> {
  try {
    const { [ACTIVE_MODULE_STORAGE]: id } = await chrome.storage.local.get(ACTIVE_MODULE_STORAGE);
    return typeof id === "string" && id ? (id as TabId) : null;
  } catch {
    return null;
  }
}

async function persistActiveModuleId(id: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [ACTIVE_MODULE_STORAGE]: id });
  } catch {
    // ignore
  }
}

function getBadge(id: TabId, state: ReturnType<typeof usePanelState>["state"]): number | null {
  if (id === "proxy") {
    if (state.globalProxy?.active) return state.globalProxy.tabCount || 1;
    const active = state.tabs?.filter((t) => t.features.proxy).length || 0;
    return active || null;
  }
  if (id === "commands") {
    return state.commandHistory?.length || null;
  }
  return null;
}

export function App() {
  const { state, refresh } = usePanelState();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    readSavedActiveModuleId().then((saved) => {
      const initial = saved && TABS.some((t) => t.id === saved) ? saved : "overview";
      setActiveTab(initial);
      setReady(true);
    });
  }, []);

  const handleSwitch = (id: TabId) => {
    setActiveTab(id);
    void persistActiveModuleId(id);
  };

  const extVersion = useMemo(() => {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return "dev";
    }
  }, []);

  const buildTimeLabel = useMemo(() => {
    try {
      const d = new Date(__BUILD_TIME_ISO__);
      if (Number.isNaN(d.getTime())) return __BUILD_TIME_ISO__;
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch {
      return __BUILD_TIME_ISO__;
    }
  }, []);

  if (!ready) {
    return (
      <div className="appShell">
        <div className="appChrome" style={{ alignItems: "center", justifyContent: "center", color: "var(--text3)" }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="appShell">
      <div className="appChrome">
        {/* Header */}
        <div className="header">
          <div className="header-logo">CP</div>
          <div className="header-title">ChromePilot</div>
          <div className="header-status">
            <span>{state.connected ? "Connected" : "Disconnected"}</span>
            <span className={`status-dot ${state.connected ? "on" : ""}`} />
          </div>
        </div>

        {/* Tab Bar */}
        <TabBar tabs={TABS} activeId={activeTab} onSwitch={handleSwitch} badge={getBadge} state={state} />

        {/* Main Content */}
        <div className="appMain">
          <div className="appMainInner">
            <div className="main">
              {activeTab === "overview" && <OverviewPanel state={state} />}
              {activeTab === "proxy" && <ProxyPanel state={state} refresh={refresh} />}
              {activeTab === "commands" && <CommandsPanel state={state} refresh={refresh} />}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="status-bar">
          <span className="status-left">v{extVersion}</span>
          <span className="status-center" title={__BUILD_TIME_ISO__}>
            Build: {buildTimeLabel}
          </span>
          <span className="status-right">{(state.browserTabs?.length || 0)} tabs</span>
        </div>
      </div>
    </div>
  );
}
