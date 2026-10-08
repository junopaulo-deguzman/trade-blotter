import { expect, it } from "vitest";
import { activeExecutions, latestExecutions } from "./execution-prices";
import { testTrade } from "@/test-utils/trades-client";

it("uses execution time, excludes cancellations, and resolves equal timestamps deterministically", () => {
  const trades = [
    { ...testTrade, tradeId: "TD-00009", price: 110, tradeTimestamp: "2026-08-19T09:00:00Z" },
    {
      ...testTrade,
      tradeId: "TD-00010",
      price: 999,
      status: "CANCELLED" as const,
      tradeTimestamp: "2026-08-20T09:00:00Z",
    },
    { ...testTrade, tradeId: "TD-00008", price: 105, tradeTimestamp: "2026-08-19T09:00:00Z" },
    { ...testTrade, tradeId: "TD-00007", price: 100, tradeTimestamp: "2026-08-18T09:00:00Z" },
    { ...testTrade, tradeId: "TD-00011", symbol: "MSFT", price: 200 },
  ];
  expect(latestExecutions(trades).get("AAPL")?.price).toBe(110);
  expect(activeExecutions(trades, "AAPL").map((trade) => trade.tradeId)).toEqual([
    "TD-00007",
    "TD-00008",
    "TD-00009",
  ]);
  expect(
    latestExecutions(
      trades.map((trade) =>
        trade.tradeId === "TD-00009" ? { ...trade, status: "CANCELLED" as const } : trade,
      ),
    ).get("AAPL")?.price,
  ).toBe(105);
  expect(trades[0].tradeId).toBe("TD-00009");
});

it("does not fabricate prices for empty or fully cancelled symbols", () => {
  expect(latestExecutions([]).size).toBe(0);
  expect(latestExecutions([{ ...testTrade, status: "CANCELLED" }]).size).toBe(0);
});

it("aggregates per UTC day and symbol, weighting by quantity and ignoring cancelled executions", async () => {
  const { dailyExecutionPrices } = await import("./execution-prices");
  const points = dailyExecutionPrices([
    { ...testTrade, price: 100, quantity: 1 },
    { ...testTrade, tradeId: "2", price: 200, quantity: 3 },
    { ...testTrade, tradeId: "3", price: 999, status: "CANCELLED" },
    { ...testTrade, tradeId: "4", symbol: "MSFT", price: 400, quantity: 2 },
    {
      ...testTrade,
      tradeId: "5",
      price: 300,
      quantity: 2,
      tradeTimestamp: "2026-08-18T23:30:00-02:00",
    },
  ]);
  expect(
    points.map(({ symbol, date, price, quantity, tradeCount }) => ({
      symbol,
      date,
      price,
      quantity,
      tradeCount,
    })),
  ).toEqual([
    { symbol: "AAPL", date: "2026-08-18", price: 175, quantity: 4, tradeCount: 2 },
    { symbol: "MSFT", date: "2026-08-18", price: 400, quantity: 2, tradeCount: 1 },
    { symbol: "AAPL", date: "2026-08-19", price: 300, quantity: 2, tradeCount: 1 },
  ]);
});

it("weights buys and sells across dates by executed quantity, excluding cancelled trades", async () => {
  const { weightedExecutionPrices } = await import("./execution-prices");
  const prices = weightedExecutionPrices([
    { ...testTrade, price: 100, quantity: 1 },
    { ...testTrade, side: "SELL", price: 200, quantity: 3, tradeTimestamp: "2026-08-19T09:00:00Z" },
    { ...testTrade, price: 999, quantity: 999, status: "CANCELLED" },
  ]);
  expect(prices.get("AAPL")).toEqual({ symbol: "AAPL", price: 175, quantity: 4, tradeCount: 2 });
  expect(weightedExecutionPrices([]).size).toBe(0);
});
