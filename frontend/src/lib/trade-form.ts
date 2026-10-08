import type { Trade, TradeSide } from "@/types/api";

export interface TradeFormValues {
  symbol: string;
  side: TradeSide | "";
  quantity: string;
  price: string;
  trader: string;
  book: string;
  counterparty: string;
  executionTime: string;
}

export function defaultTradeForm(): TradeFormValues {
  return {
    symbol: "",
    side: "",
    quantity: "",
    price: "",
    trader: "",
    book: "",
    counterparty: "",
    executionTime: new Date().toISOString().slice(0, 19),
  };
}

export function tradeToForm(trade: Trade): TradeFormValues {
  return {
    symbol: trade.symbol,
    side: trade.side,
    quantity: String(trade.quantity),
    price: String(trade.price),
    trader: trade.trader,
    book: trade.book,
    counterparty: trade.counterparty,
    executionTime: trade.tradeTimestamp.slice(0, 19),
  };
}

export function readableTradeSummary(values: TradeFormValues): string {
  const quantity = Number(values.quantity);
  const price = Number(values.price);
  const amount =
    Number.isFinite(quantity) && quantity > 0 ? quantity.toLocaleString("en-GB") : "[quantity]";
  const tradePrice =
    Number.isFinite(price) && price > 0
      ? price.toLocaleString("en-GB", { maximumFractionDigits: 20 })
      : "[price]";
  const action =
    values.side === "BUY" ? "bought" : values.side === "SELL" ? "sold" : "[buys / sells]";
  const direction = values.side === "SELL" ? "to" : "from";
  return `${values.trader || "[trader]"}’s ${action} ${amount} ${values.symbol || "[symbol]"} shares ${direction} ${values.counterparty || "[counterparty]"} at ${tradePrice} per share, booked to ${values.book || "[book]"}`;
}

/** datetime-local is deliberately displayed as UTC, matching the trade table. */
export function tradeTimeToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const date = new Date(`${value}Z`);
  if (!Number.isFinite(date.getTime())) return null;
  if (date.toISOString().slice(0, value.length) !== value) return null;
  return date.toISOString();
}
