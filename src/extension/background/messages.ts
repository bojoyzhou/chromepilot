export interface BridgeEvent<T = unknown> {
  _event: true;
  type: string;
  tabId?: number;
  data: T;
  ts: number;
}

export interface BaseCommand {
  id?: string | number;
  action?: string;
  tabId?: number;
  urlMatch?: string;
}

export type CommandHandler = (cmd: BaseCommand) => Promise<unknown> | unknown;
