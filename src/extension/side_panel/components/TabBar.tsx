import type { TabConfig, TabId } from "../types";
import type { PanelState } from "../types";

interface TabBarProps {
  tabs: TabConfig[];
  activeId: TabId;
  onSwitch: (id: TabId) => void;
  badge?: (id: TabId, state: PanelState) => number | null;
  state: PanelState;
}

export function TabBar({ tabs, activeId, onSwitch, badge, state }: TabBarProps) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const badgeVal = badge ? badge(tab.id, state) : null;
        return (
          <button
            key={tab.id}
            className={`tab-btn ${isActive ? "active" : ""}`}
            onClick={() => onSwitch(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            {tab.label}
            {badgeVal !== null && badgeVal !== undefined && (
              <span className="tab-badge">{badgeVal}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
