import { executionDate } from "./trade-date-range";
import type { Trade } from "@/types/api";

/** Execution timestamps determine the price reference, not arrival/update order. */
export function activeExecutions(trades: readonly Trade[], symbol: string | null = null): Trade[] {
  return trades
    .filter((trade) => trade.status === "ACTIVE" && (!symbol || trade.symbol === symbol))
    .sort(
      (a, b) =>
        Date.parse(a.tradeTimestamp) - Date.parse(b.tradeTimestamp) ||
        a.tradeId.localeCompare(b.tradeId),
    );
}

export function latestExecutions(trades: readonly Trade[]): Map<string, Trade> {
  const latest = new Map<string, Trade>();
  for (const trade of activeExecutions(trades)) latest.set(trade.symbol, trade);
  return latest;
}

export const formatPrice = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatValue = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});
export const formatExecutionTime = (timestamp: string) =>
  `${new Date(timestamp).toISOString().replace("T", " ").slice(0, 16)} UTC`;
const colours = ["#2563eb", "#b45309", "#059669", "#9333ea", "#db2777", "#0891b2", "#dc2626"];
export function symbolColours(trades: readonly Trade[]): Map<string, string> {
  return new Map(
    [...new Set(trades.map((trade) => trade.symbol))]
      .sort()
      .map((symbol, i) => [symbol, colours[i % colours.length]]),
  );
}

export interface DailyExecutionPrice {
  id: string;
  symbol: string;
  date: string;
  price: number;
  quantity: number;
  tradeCount: number;
}
/** One quantity-weighted execution price per symbol and UTC day. */
export function dailyExecutionPrices(
  trades: readonly Trade[],
  symbol: string | null = null,
): DailyExecutionPrice[] {
  const days = new Map<string, DailyExecutionPrice & { notional: number }>();
  for (const trade of activeExecutions(trades, symbol)) {
    const date = executionDate(trade);
    const id = `${trade.symbol}/${date}`;
    const day = days.get(id) ?? {
      id,
      symbol: trade.symbol,
      date,
      price: 0,
      quantity: 0,
      tradeCount: 0,
      notional: 0,
    };
    day.quantity += trade.quantity;
    day.notional += trade.price * trade.quantity;
    day.tradeCount++;
    days.set(id, day);
  }
  return [...days.values()]
    .map(({ notional, ...day }) => ({ ...day, price: notional / day.quantity }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
}

export interface WeightedExecutionPrice {
  symbol: string;
  price: number;
  quantity: number;
  tradeCount: number;
}
/** Weight executions themselves, rather than taking an unweighted mean of daily means. */
export function weightedExecutionPrices(
  trades: readonly Trade[],
): Map<string, WeightedExecutionPrice> {
  const totals = new Map<string, WeightedExecutionPrice & { notional: number }>();
  for (const trade of trades) {
    if (trade.status !== "ACTIVE") continue;
    const total = totals.get(trade.symbol) ?? {
      symbol: trade.symbol,
      price: 0,
      quantity: 0,
      tradeCount: 0,
      notional: 0,
    };
    total.notional += trade.price * trade.quantity;
    total.quantity += trade.quantity;
    total.tradeCount++;
    totals.set(trade.symbol, total);
  }
  return new Map(
    [...totals].map(([symbol, { notional, ...total }]) => [
      symbol,
      { ...total, price: notional / total.quantity },
    ]),
  );
}
