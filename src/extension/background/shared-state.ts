// Shared mutable state — centralized to avoid circular dependencies
// All Map/Set state variables that are accessed across multiple modules

export const MAX_PROXY_LOG = 200;

export interface ProxyTabState {
  rules: Array<Record<string, unknown>>;
  log: Array<Record<string, unknown>>;
  _global?: boolean;
  _paused?: boolean;
  whistleText?: string;
}

export interface GlobalProxyState {
  rules: Array<Record<string, unknown>>;
  whistleText: string;
  paused?: boolean;
}

export interface CommandHistoryEntry {
  id: string | number | null;
  action: string | null;
  tabId: number | null;
  urlMatch: string | null;
  ts: number;
  raw: string;
}

export const networkBuffers = new Map<number, Array<Record<string, unknown>>>();
export const consoleBuffers = new Map<number, Array<Record<string, unknown>>>();
export const debuggerTabs = new Set<number>();
export const interceptRules = new Map<number, Array<Record<string, unknown>>>();
export const pendingBodies = new Map<
  number,
  Map<string, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>
>();
export const proxyState = new Map<number, ProxyTabState>();
export let globalProxy: GlobalProxyState | null = null;
export const commandHistory: CommandHistoryEntry[] = [];
export const MAX_COMMAND_HISTORY = 100;

export function setGlobalProxy(value: GlobalProxyState | null): void {
  globalProxy = value;
}
