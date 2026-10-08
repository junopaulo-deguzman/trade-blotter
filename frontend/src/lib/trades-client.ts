import { createHttpClient, type HttpOptions } from "./http-client";
import type {
  OpeningHolding,
  Trade,
  TradeFormOptions,
  TradeInput,
  TradeListResponse,
  TradesClient,
} from "@/types/api";

export function deriveTradeOptions(trades: Trade[]): TradeFormOptions {
  const unique = (values: string[]) => [...new Set(values)].sort();
  return {
    symbols: unique(trades.map((trade) => trade.symbol)),
    traders: unique(trades.map((trade) => trade.trader)),
    books: unique(trades.map((trade) => trade.book)),
    counterparties: unique(trades.map((trade) => trade.counterparty)),
  };
}

export function createApiTradesClient(baseUrl: string, options: HttpOptions = {}): TradesClient {
  const request = createHttpClient(baseUrl, options);
  return {
    openingHoldings: (signal) => request<OpeningHolding[]>("/positions/opening", { signal }),
    getTradeById: (tradeId, signal) =>
      request<Trade>(`/trades/${encodeURIComponent(tradeId)}`, { signal }),
    async list(signal) {
      const trades: Trade[] = [];
      const limit = 100;
      let offset = 0;
      while (true) {
        const page = await request<TradeListResponse>(`/trades?limit=${limit}&offset=${offset}`, {
          signal,
        });
        trades.push(...page.trades);
        offset += page.trades.length;
        if (offset >= page.pagination.total || page.trades.length === 0) return trades;
      }
    },
    options: (signal) => request<TradeFormOptions>("/trades/options", { signal }),
    cancel: (tradeId) =>
      request<Trade>(`/trades/cancel/${encodeURIComponent(tradeId)}`, { method: "PATCH" }),
    amend: (tradeId, input) =>
      request<Trade>(`/trades/${encodeURIComponent(tradeId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    create: (input: TradeInput) =>
      request<Trade>("/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
  };
}

export function createConfiguredTradesClient(options: HttpOptions = {}): TradesClient {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || "/api";
  return createApiTradesClient(baseUrl, options);
}
