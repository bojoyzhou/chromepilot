import { useEffect, useMemo } from "react";

export function App() {
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
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
        d.getMinutes(),
      )}:${pad(d.getSeconds())}`;
    } catch {
      return __BUILD_TIME_ISO__;
    }
  }, []);

  useEffect(() => {
    void import("./legacy").then((m) => {
      void m.mountLegacySidePanelUi();
    });
  }, []);

  return (
    <div className="appShell">
      <div className="appChrome">
        <div className="header">
          <div className="header-logo">CP</div>
          <div className="header-title">ChromePilot</div>
          <div className="header-status">
            <span id="statusText">Connecting...</span>
            <span className="status-dot" id="statusDot"></span>
          </div>
        </div>

        <div className="tab-bar" id="tabBar"></div>

        <div className="appMain">
          <div className="appMainInner">
            <div className="main" id="mainContent"></div>
          </div>
        </div>

        <div className="status-bar">
          <span className="status-left">v{extVersion}</span>
          <span className="status-center" title={__BUILD_TIME_ISO__}>
            Build: {buildTimeLabel}
          </span>
          <span className="status-right" id="footerRight"></span>
        </div>
      </div>
    </div>
  );
}
