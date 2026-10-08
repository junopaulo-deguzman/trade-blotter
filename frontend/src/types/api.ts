export type TradeStatus = "ACTIVE" | "CANCELLED";
export type TradeSide = "BUY" | "SELL";

export interface Trade {
  tradeId: string;
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  trader: string;
  book: string;
  counterparty: string;
  status: TradeStatus;
  recordedById: string;
  tradeTimestamp: string;
}

export interface Instrument {
  symbol: string;
  name: string;
}

export interface TradeInput {
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  trader: string;
  book: string;
  counterparty: string;
  tradeTimestamp: string;
}

export interface TradeFormOptions {
  symbols: string[];
  traders: string[];
  books: string[];
  counterparties: string[];
}

export interface TradeListResponse {
  trades: Trade[];
  pagination: { limit: number; offset: number; total: number };
}

/** Recorder and initial ACTIVE status are assigned by the server. */
export interface OpeningHolding {
  book: string;
  symbol: string;
  quantity: number;
}

export interface TradesClient {
  openingHoldings: (signal?: AbortSignal) => Promise<OpeningHolding[]>;
  getTradeById: (tradeId: string, signal?: AbortSignal) => Promise<Trade>;
  list: (signal?: AbortSignal) => Promise<Trade[]>;
  options: (signal?: AbortSignal) => Promise<TradeFormOptions>;
  cancel: (tradeId: string) => Promise<Trade>;
  amend: (tradeId: string, input: TradeInput) => Promise<Trade>;
  create: (input: TradeInput) => Promise<Trade>;
}
