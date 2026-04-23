function enableSidePanelOnActionClick(): void {
  const sidePanel = chrome.sidePanel;
  if (!sidePanel?.setPanelBehavior) return;

  void sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("[chromepilot] sidePanel.setPanelBehavior failed:", error));
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanelOnActionClick();
});

enableSidePanelOnActionClick();
