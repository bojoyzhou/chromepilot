import { useState } from "react";
import { timeAgo } from "../modules/utils";
import type { PanelState } from "../types";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import "./CommandsPanel.scss";

interface CommandsPanelProps {
  state: PanelState;
  refresh: () => void;
}

export function CommandsPanel({ state, refresh }: CommandsPanelProps) {
  const history = state.commandHistory || [];
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpand = (index: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleClear = async () => {
    await chrome.runtime.sendMessage({ type: "clearCommandHistory" });
    refresh();
  };

  return (
    <div className="commands-panel">
      <Card title="Agent 指令历史" countText={history.length + " 条"}>
        {history.length === 0 ? (
          <EmptyState icon="⚡" text="暂无指令记录，当 Agent 发送指令后将在此显示" />
        ) : (
          <>
            {[...history].reverse().map((entry, idx) => {
              const isExpanded = expandedIds.has(idx);
              const metaParts: string[] = [];
              if (entry.tabId) metaParts.push("Tab #" + entry.tabId);
              if (entry.urlMatch) metaParts.push("match:" + entry.urlMatch);
              metaParts.push(timeAgo(entry.ts));

              return (
                <div key={idx} className={`command-item ${idx === 0 ? "command-item-new" : ""}`}>
                  <div className="command-header">
                    <span className="command-action">{entry.action || "event"}</span>
                    <span className="command-meta">{metaParts.join(" · ")}</span>
                  </div>
                  <span className="command-expand" onClick={() => toggleExpand(idx)}>
                    {isExpanded ? "收起详情" : "展开详情"}
                  </span>
                  {isExpanded && <div className="command-raw">{entry.raw}</div>}
                </div>
              );
            })}
            <div className="btn-row">
              <button className="btn btn-danger" onClick={handleClear}>
                清空记录
              </button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
