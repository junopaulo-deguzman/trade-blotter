import { deriveTradeOptions } from "@/lib/trades-client";
import type { OpeningHolding, Trade, TradeInput, TradesClient } from "@/types/api";

export const testTrade: Trade = {
  tradeId: "TD-00001",
  symbol: "AAPL",
  side: "BUY",
  quantity: 1,
  price: 10,
  trader: "JSMITH",
  book: "UK",
  counterparty: "Bank",
  status: "ACTIVE",
  recordedById: "1",
  tradeTimestamp: "2026-08-18T09:15:23Z",
};

export function createInMemoryTradesClient(
  initialTrades: Trade[] = [testTrade],
  holdings: OpeningHolding[] = [],
): TradesClient {
  let trades = [...initialTrades];
  let nextId = 0;

  return {
    async openingHoldings() {
      return [...holdings];
    },
    async getTradeById(tradeId) {
      const trade = trades.find((item) => item.tradeId === tradeId);
      if (!trade) throw new Error("Trade not found");
      return trade;
    },
    async list() {
      return [...trades];
    },
    async options() {
      return deriveTradeOptions(trades);
    },
    async cancel(tradeId) {
      const index = trades.findIndex((trade) => trade.tradeId === tradeId);
      if (index < 0) throw new Error("Trade not found");
      trades[index] = { ...trades[index], status: "CANCELLED" };
      return trades[index];
    },
    async amend(tradeId, input) {
      const index = trades.findIndex((trade) => trade.tradeId === tradeId);
      if (index < 0) throw new Error("Trade not found");
      trades[index] = { ...trades[index], ...input };
      return trades[index];
    },
    async create(input: TradeInput) {
      const trade: Trade = {
        ...input,
        tradeId: `TEST-${String(++nextId).padStart(5, "0")}`,
        status: "ACTIVE",
        recordedById: "1",
      };
      trades = [trade, ...trades];
      return trade;
    },
  };
}
