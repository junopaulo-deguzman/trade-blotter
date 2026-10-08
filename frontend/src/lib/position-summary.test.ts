import { expect, it } from "vitest";
import { summarizeSymbols, summarizePositions } from "./position-summary";
import { testTrade } from "@/test-utils/trades-client";

it("keeps books separate and combines opening holdings with active trades", () => {
  const trades = [
    { ...testTrade, quantity: 1200 },
    { ...testTrade, quantity: 50, book: "Other", trader: "OTHER", recordedById: "2" },
    { ...testTrade, side: "SELL" as const, quantity: 300 },
    { ...testTrade, status: "CANCELLED" as const, quantity: 9999 },
  ];
  expect(summarizePositions(trades, [{ book: "UK", symbol: "AAPL", quantity: 500 }])).toEqual([
    {
      book: "Other",
      symbol: "AAPL",
      openingQuantity: 0,
      boughtQuantity: 50,
      soldQuantity: 0,
      netQuantity: 50,
      currentQuantity: 50,
    },
    {
      book: "UK",
      symbol: "AAPL",
      openingQuantity: 500,
      boughtQuantity: 1200,
      soldQuantity: 300,
      netQuantity: 900,
      currentQuantity: 1400,
    },
  ]);
  expect(trades[0].quantity).toBe(1200);
});

it("includes holdings without trades and permits zero and negative current positions", () => {
  const rows = summarizePositions(
    [
      { ...testTrade, symbol: "TSLA", side: "SELL", quantity: 5 },
      { ...testTrade, quantity: 1000 },
      { ...testTrade, side: "SELL", quantity: 1000 },
      { ...testTrade, symbol: "MSFT", status: "CANCELLED" },
    ],
    [{ book: "UK", symbol: "MSFT", quantity: 100 }],
  );
  expect(rows.map((row) => [row.book, row.symbol, row.netQuantity, row.currentQuantity])).toEqual([
    ["UK", "AAPL", 0, 0],
    ["UK", "MSFT", 0, 100],
    ["UK", "TSLA", -5, -5],
  ]);
});

it("returns no positions for empty or fully cancelled datasets without holdings", () => {
  expect(summarizePositions([])).toEqual([]);
  expect(summarizePositions([{ ...testTrade, status: "CANCELLED" }])).toEqual([]);
});

it("combines per-symbol positions across books without dropping opening-only holdings", () => {
  const positions = summarizeSymbols(
    [
      { ...testTrade, quantity: 100 },
      { ...testTrade, book: "US", side: "SELL", quantity: 40 },
      { ...testTrade, book: "US", status: "CANCELLED", quantity: 999 },
    ],
    [
      { book: "UK", symbol: "AAPL", quantity: 500 },
      { book: "US", symbol: "AAPL", quantity: 100 },
      { book: "US", symbol: "MSFT", quantity: 20 },
    ],
  );
  expect(positions).toEqual([
    {
      symbol: "AAPL",
      openingQuantity: 600,
      boughtQuantity: 100,
      soldQuantity: 40,
      netQuantity: 60,
      currentQuantity: 660,
    },
    {
      symbol: "MSFT",
      openingQuantity: 20,
      boughtQuantity: 0,
      soldQuantity: 0,
      netQuantity: 0,
      currentQuantity: 20,
    },
  ]);
});
