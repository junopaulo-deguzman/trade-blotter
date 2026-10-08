import { describe, expect, it, vi } from "vitest";
import { createApiTradesClient, deriveTradeOptions } from "./trades-client";
import { defaultTradeForm, readableTradeSummary } from "./trade-form";
import type { Trade, TradeInput } from "@/types/api";
import { testTrade } from "@/test-utils/trades-client";

const input: TradeInput = {
  symbol: "AAPL",
  side: "BUY",
  quantity: 1200,
  price: 227.45,
  trader: "JSMITH",
  book: "EQUITIES_UK",
  counterparty: "Goldman Sachs",
  tradeTimestamp: "2026-08-18T09:15:23.000Z",
};

describe("trade clients", () => {
  it("derives unique sorted options from trades", () => {
    const trades: Trade[] = [
      testTrade,
      { ...testTrade, tradeId: "TD-00002", symbol: "MSFT", trader: "ABROWN" },
      { ...testTrade, tradeId: "TD-00003", symbol: "AAPL", trader: "JSMITH" },
    ];

    expect(deriveTradeOptions(trades)).toEqual({
      symbols: ["AAPL", "MSFT"],
      traders: ["ABROWN", "JSMITH"],
      books: ["UK"],
      counterparties: ["Bank"],
    });
  });

  it("fetches all pages and sends only the creation fields", async () => {
    const trade = testTrade;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            trades: [trade],
            pagination: { limit: 100, offset: 0, total: 2 },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            trades: [{ ...trade, tradeId: "TD-00002" }],
            pagination: { limit: 100, offset: 1, total: 2 },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(trade)));
    vi.stubGlobal("fetch", fetchMock);
    const client = createApiTradesClient("/api/");
    expect(await client.list()).toHaveLength(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/trades?limit=100&offset=1");
    await client.create(input);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(input),
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).not.toHaveProperty("recordedById");
  });

  it("fetches options with a signal and reports API errors", async () => {
    const options = deriveTradeOptions([testTrade]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(options)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Unknown symbol" }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createApiTradesClient("/api");
    expect(await client.options(new AbortController().signal)).toEqual(options);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    await expect(client.create(input)).rejects.toThrow("Unknown symbol");
    await expect(client.create(input)).rejects.toThrow("Request failed (503)");
  });
});

describe("trade summary and execution time", () => {
  const values = {
    ...defaultTradeForm(),
    ...input,
    quantity: "1200",
    price: "227.45",
  };
  it("expresses buy and sell from the book's perspective", () => {
    expect(readableTradeSummary(values)).toBe(
      "JSMITH’s bought 1,200 AAPL shares from Goldman Sachs at 227.45 per share, booked to EQUITIES_UK",
    );
    expect(readableTradeSummary({ ...values, side: "SELL" })).toContain(
      "sold 1,200 AAPL shares to Goldman Sachs",
    );
    expect(readableTradeSummary(defaultTradeForm())).toContain("[quantity]");
  });
});
