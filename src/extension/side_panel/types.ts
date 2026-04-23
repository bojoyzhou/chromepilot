export interface Features {
  network: boolean;
  console: boolean;
  intercept: boolean;
  proxy: boolean;
}

export interface ProxyState {
  rules: ProxyRule[];
  log: ProxyLogEntry[];
  whistleText?: string;
  _global?: boolean;
}

export interface FeatureTab {
  tabId: number;
  features: Features;
  networkCount?: number;
  consoleCount?: number;
  proxy: ProxyState | null;
}

export interface BrowserTab {
  tabId: number;
  url?: string;
  title?: string;
  active?: boolean;
}

export interface ProxyRule {
  pattern?: string;
  action?: string;
  target?: string;
  setHost?: string;
  delay?: number;
  setHeaders?: Record<string, string>;
  response?: {
    status?: number;
    body?: string;
    headers?: Record<string, string>;
  };
}

export interface ProxyLogEntry {
  url?: string;
  method?: string;
  action?: string;
  pattern?: string;
  detail?: string;
  ts?: number;
  headerMods?: string;
}

export interface GlobalProxyState {
  active: boolean;
  paused?: boolean;
  rules: ProxyRule[];
  whistleText?: string;
  tabCount?: number;
  log: ProxyLogEntry[];
}

export interface CommandHistoryEntry {
  id: string | number | null;
  action: string | null;
  tabId: number | null;
  urlMatch: string | null;
  ts: number;
  raw: string;
}

export interface PanelState {
  connected: boolean;
  tabs: FeatureTab[];
  browserTabs: BrowserTab[];
  globalProxy: GlobalProxyState | null;
  commandHistory: CommandHistoryEntry[];
}

export type TabId = "overview" | "proxy" | "commands";

export interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}
