/** POST /api/ws/ticket, authenticated with the existing bearer token. */
export interface WebSocketTicket {
  ticket: string;
  expiresAt: string;
}
export interface TradeChangedEvent {
  type: "trade.changed";
  tradeId: string;
  action: "created" | "amended" | "cancelled";
}
/** JSON text frames received from /api/ws?ticket=<single-use-ticket>. */
export type RealtimeServerEvent =
  | { type: "connection.ready"; connectionId: string }
  | TradeChangedEvent
  | PresenceEvent;
export const realtimeCloseCodes = {
  unauthorized: 4401,
  shutdown: 1001,
  unsupportedMessage: 1008,
  internalError: 1011,
} as const;

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
