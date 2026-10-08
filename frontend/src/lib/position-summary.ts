import type { OpeningHolding, Trade } from "@/types/api";

export interface PositionSummaryRow {
  book: string;
  symbol: string;
  openingQuantity: number;
  boughtQuantity: number;
  soldQuantity: number;
  netQuantity: number;
  currentQuantity: number;
}

/** Opening holdings plus signed quantities from recorded active trades. */
export function summarizePositions(
  trades: readonly Trade[],
  holdings: readonly OpeningHolding[] = [],
): PositionSummaryRow[] {
  const positions = new Map<string, PositionSummaryRow>();
  function positionFor(book: string, symbol: string) {
    const key = JSON.stringify([book, symbol]);
    let position = positions.get(key);
    if (!position) {
      position = {
        book,
        symbol,
        openingQuantity: 0,
        boughtQuantity: 0,
        soldQuantity: 0,
        netQuantity: 0,
        currentQuantity: 0,
      };
      positions.set(key, position);
    }
    return position;
  }
  for (const holding of holdings)
    positionFor(holding.book, holding.symbol).openingQuantity += holding.quantity;
  for (const trade of trades) {
    if (trade.status !== "ACTIVE") continue;
    const position = positionFor(trade.book, trade.symbol);
    if (trade.side === "BUY") position.boughtQuantity += trade.quantity;
    else position.soldQuantity += trade.quantity;
  }
  for (const position of positions.values()) {
    position.netQuantity = position.boughtQuantity - position.soldQuantity;
    position.currentQuantity = position.openingQuantity + position.netQuantity;
  }
  return [...positions.values()].sort(
    (a, b) => a.book.localeCompare(b.book) || a.symbol.localeCompare(b.symbol),
  );
}

export type SymbolPosition = Omit<PositionSummaryRow, "book">;

export function summarizeSymbols(
  trades: readonly Trade[],
  holdings: readonly OpeningHolding[] = [],
): SymbolPosition[] {
  const symbols = new Map<string, SymbolPosition>();
  for (const position of summarizePositions(trades, holdings)) {
    let symbol = symbols.get(position.symbol);
    if (!symbol) {
      symbol = {
        symbol: position.symbol,
        openingQuantity: 0,
        boughtQuantity: 0,
        soldQuantity: 0,
        netQuantity: 0,
        currentQuantity: 0,
      };
      symbols.set(position.symbol, symbol);
    }
    symbol.openingQuantity += position.openingQuantity;
    symbol.boughtQuantity += position.boughtQuantity;
    symbol.soldQuantity += position.soldQuantity;
    symbol.netQuantity += position.netQuantity;
    symbol.currentQuantity += position.currentQuantity;
  }
  return [...symbols.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}
