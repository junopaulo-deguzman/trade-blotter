import { EventEmitter } from "node:events";

export interface TradeChangedEvent {
  type: "trade.changed";
  tradeId: string;
  action: "created" | "amended" | "cancelled";
}
export type ServerEvent =
  | { type: "connection.ready"; connectionId: string }
  | TradeChangedEvent
  | PresenceEvent;

const events = new EventEmitter();
export function publishTradeChanged(event: Omit<TradeChangedEvent, "type">): void {
  events.emit("change", { type: "trade.changed", ...event } satisfies TradeChangedEvent);
}
export function subscribeTradeChanges(listener: (event: TradeChangedEvent) => void): () => void {
  events.on("change", listener);
  return () => {
    events.off("change", listener);
  };
}

export interface Editor {
  connectionId: string;
  userId: number;
  name: string;
}
export interface EditingPresence {
  tradeId: string;
  editors: Editor[];
}
export type PresenceEvent =
  | { type: "editing.snapshot"; trades: EditingPresence[] }
  | ({ type: "trade.editing" } & EditingPresence);
