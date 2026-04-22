export interface BackgroundState {
  wsUrl: string;
  connected: boolean;
}

const DEFAULT_WS = "ws://127.0.0.1:8787/ws";

export const backgroundState: BackgroundState = {
  wsUrl: DEFAULT_WS,
  connected: false,
};

export function setWsUrl(url?: string): void {
  backgroundState.wsUrl = url || DEFAULT_WS;
}

export function setConnected(connected: boolean): void {
  backgroundState.connected = connected;
}
