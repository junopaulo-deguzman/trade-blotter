import type { PresenceEvent, TradeChangedEvent } from "@/types/ws";
import type { AuthClient } from "@/types/auth";
import type { TradesClient } from "@/types/api";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";
export interface TradeUpdatesClient {
  setEditingTrade?: (tradeId: string | null) => void;
  subscribe(callbacks: {
    onPresence?: (event: PresenceEvent) => void;
    onReady?: (connectionId: string) => void;
    onChange: (event: TradeChangedEvent) => void;
    onStatus: (status: ConnectionStatus) => void;
  }): () => void;
}

export interface Services {
  trades: TradesClient;
  auth: AuthClient;
  updates?: TradeUpdatesClient;
  saveRevision: number;
}
