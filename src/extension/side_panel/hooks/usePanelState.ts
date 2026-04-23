import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelState } from "../types";

const DEFAULT_STATE: PanelState = {
  connected: false,
  tabs: [],
  browserTabs: [],
  globalProxy: null,
  commandHistory: [],
};

export function usePanelState() {
  const [state, setState] = useState<PanelState>(DEFAULT_STATE);
  const lastHashRef = useRef("");

  const fetchState = useCallback(async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "getState" });
      if (!res) return;
      const hash = JSON.stringify(res);
      if (hash === lastHashRef.current) return;
      lastHashRef.current = hash;
      setState(res as PanelState);
    } catch {
      const fallback = JSON.stringify({ connected: false });
      if (fallback === lastHashRef.current) return;
      lastHashRef.current = fallback;
      setState((prev) => ({ ...prev, connected: false }));
    }
  }, []);

  useEffect(() => {
    fetchState();
    const timer = setInterval(fetchState, 1500);
    return () => clearInterval(timer);
  }, [fetchState]);

  return { state, refresh: fetchState };
}
