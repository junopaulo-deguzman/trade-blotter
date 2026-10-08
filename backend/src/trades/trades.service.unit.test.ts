import * as counterparties from "../counterparties/counterparties.repository.ts";
import * as books from "../books/books.repository.ts";
import { DatabaseError } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTrades,
  getTrade,
  createTrade,
  getTradeOptions,
  cancelTrade,
  amendTrade,
} from "./trades.service.ts";
import * as repo from "./trades.repository.ts";
import * as instruments from "../instruments/instruments.service.ts";
import * as traders from "../traders/traders.service.ts";
import type { TradeListRow, TradeInput } from "./trades.types.ts";
import { subscribeTradeChanges } from "../ws/events.ts";
import { TradeError } from "./trades.errors.ts";
vi.mock("../counterparties/counterparties.repository.ts", () => ({
  selectCounterpartyByName: vi.fn(),
}));
vi.mock("../books/books.repository.ts", () => ({ selectBookByCode: vi.fn() }));
vi.mock("./trades.repository.ts", () => ({
  listTrades: vi.fn(),
  getTradeById: vi.fn(),
  insertTrade: vi.fn(),
  setTradeStatusToCancel: vi.fn(),
  updateTrade: vi.fn(),
  selectBookingOptions: vi.fn(),
}));
vi.mock("../instruments/instruments.service.ts", () => ({
  getInstrumentBySymbol: vi.fn(),
  getInstruments: vi.fn(),
}));
vi.mock("../traders/traders.service.ts", () => ({ getTraderByCode: vi.fn(), getTraders: vi.fn() }));
const row: TradeListRow = {
  id: 42,
  symbol_id: 7,
  symbol: "AAPL",
  trader_id: 3,
  trader_code: "ABROWN",
  quantity: 500,
  price: "227.45",
  trade_timestamp: new Date("2026-08-18T09:15:23Z"),
  side: "BUY",
  status: "ACTIVE",
  book: "EQUITIES_UK",
  counterparty: "Goldman Sachs",
  recorded_by_id: 8,
};
const input: TradeInput = {
  symbol: "AAPL",
  trader: "ABROWN",
  quantity: 500,
  price: 227.45,
  side: "BUY",
  book: row.book,
  counterparty: row.counterparty,
  tradeTimestamp: row.trade_timestamp.toISOString(),
};
const response = {
  tradeId: "TD-00042",
  symbol: "AAPL",
  trader: "ABROWN",
  quantity: 500,
  price: 227.45,
  tradeTimestamp: "2026-08-18T09:15:23.000Z",
  side: "BUY",
  status: "ACTIVE",
  book: row.book,
  counterparty: row.counterparty,
  recordedById: "8",
};
beforeEach(() => vi.resetAllMocks());
describe("trade services", () => {
  it("maps database numeric/date fields and returns pagination", async () => {
    vi.mocked(repo.listTrades).mockResolvedValue({ rows: [row], total: 17 });
    await expect(getTrades({ limit: 10, offset: 5 })).resolves.toEqual({
      trades: [response],
      pagination: { limit: 10, offset: 5, total: 17 },
    });
  });
  it("returns consistent single-trade mapping and handles absence", async () => {
    vi.mocked(repo.getTradeById).mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    await expect(getTrade(42)).resolves.toEqual(response);
    await expect(getTrade(43)).rejects.toMatchObject({
      constructor: TradeError,
      failure: { reason: "trade_not_found", tradeId: 43 },
    });
  });
  it("resolves references and inserts with the authenticated recorder", async () => {
    vi.mocked(instruments.getInstrumentBySymbol).mockResolvedValue({
      id: 7,
      symbol: "AAPL",
      name: "Apple",
    });
    vi.mocked(traders.getTraderByCode).mockResolvedValue({
      id: 3,
      trader_code: "ABROWN",
      name: "Alex",
    });
    vi.mocked(repo.insertTrade).mockResolvedValue(row);
    const changed = vi.fn();
    const unsubscribe = subscribeTradeChanges(changed);
    try {
      await expect(createTrade(input, 8)).resolves.toEqual(response);
      expect(changed).toHaveBeenCalledWith({
        type: "trade.changed",
        tradeId: "TD-00042",
        action: "created",
      });
    } finally {
      unsubscribe();
    }
    expect(repo.insertTrade).toHaveBeenCalledWith({
      symbolId: 7,
      traderId: 3,
      recordedById: 8,
      quantity: 500,
      price: 227.45,
      side: "BUY",
      book: row.book,
      counterparty: row.counterparty,
      tradeTimestamp: input.tradeTimestamp,
    });
  });
  it("rejects unknown symbols before inserting", async () => {
    vi.mocked(instruments.getInstrumentBySymbol).mockResolvedValue(null);
    await expect(createTrade(input, 8)).rejects.toMatchObject({
      constructor: TradeError,
      failure: { reason: "unknown_instrument", symbol: input.symbol },
    });
    expect(repo.insertTrade).not.toHaveBeenCalled();
  });
  it("rejects unknown trader codes before inserting", async () => {
    vi.mocked(instruments.getInstrumentBySymbol).mockResolvedValue({
      id: 7,
      symbol: "AAPL",
      name: "Apple",
    });
    vi.mocked(traders.getTraderByCode).mockResolvedValue(null);
    await expect(createTrade(input, 8)).rejects.toMatchObject({
      constructor: TradeError,
      failure: { reason: "unknown_trader", traderCode: input.trader },
    });
    expect(repo.insertTrade).not.toHaveBeenCalled();
  });
  it("includes reference codes without prior trades in form options", async () => {
    vi.mocked(instruments.getInstruments).mockResolvedValue([
      { symbol: "MSFT", name: "Microsoft" },
    ]);
    vi.mocked(traders.getTraders).mockResolvedValue([{ traderCode: "ABROWN", traderName: "Alex" }]);
    vi.mocked(repo.selectBookingOptions).mockResolvedValue({ books: [], counterparties: [] });
    await expect(getTradeOptions()).resolves.toEqual({
      symbols: ["MSFT"],
      traders: ["ABROWN"],
      books: [],
      counterparties: [],
    });
  });
});

describe("recording failures during persistence", () => {
  beforeEach(() => {
    vi.mocked(instruments.getInstrumentBySymbol).mockResolvedValue({
      id: 7,
      symbol: "AAPL",
      name: "Apple",
    });
    vi.mocked(traders.getTraderByCode).mockResolvedValue({
      id: 3,
      trader_code: "ABROWN",
      name: "Alex",
    });
  });
  it.each([
    ["fk_trade_symbol_id", { reason: "unknown_instrument", symbol: input.symbol }],
    ["fk_trade_trader_id", { reason: "unknown_trader", traderCode: input.trader }],
    ["fk_trade_book_code", { reason: "unknown_book", book: input.book }],
    [
      "fk_trade_counterparty_name",
      { reason: "unknown_counterparty", counterparty: input.counterparty },
    ],
    ["fk_trade_recorded_by_id", { reason: "recorder_not_found", recorderId: 8 }],
  ] as const)("handles a reference removed before recording: %s", async (constraint, failure) => {
    const error = new DatabaseError("foreign key violation", 0, "error");
    error.code = "23503";
    error.constraint = constraint;
    vi.mocked(repo.insertTrade).mockRejectedValue(error);
    await expect(createTrade(input, 8)).rejects.toMatchObject({
      constructor: TradeError,
      failure,
    });
  });
  it("preserves unexpected persistence failures instead of mislabelling them as user conflicts", async () => {
    const error = new DatabaseError("sequence collision", 0, "error");
    error.code = "23505";
    error.constraint = "trades_pkey";
    vi.mocked(repo.insertTrade).mockRejectedValue(error);
    const changed = vi.fn();
    const unsubscribe = subscribeTradeChanges(changed);
    try {
      await expect(createTrade(input, 8)).rejects.toBe(error);
      expect(changed).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});

describe("trade change events", () => {
  beforeEach(() => {
    vi.mocked(instruments.getInstrumentBySymbol).mockResolvedValue({
      id: 7,
      symbol: "AAPL",
      name: "Apple",
    });
    vi.mocked(traders.getTraderByCode).mockResolvedValue({
      id: 3,
      trader_code: "ABROWN",
      name: "Alex",
    });
  });
  it("publishes cancellation and amendment after persistence", async () => {
    vi.mocked(repo.setTradeStatusToCancel).mockResolvedValue({ ...row, status: "CANCELLED" });
    vi.mocked(repo.updateTrade).mockResolvedValue({ ...row, quantity: 12 });
    const changed = vi.fn();
    const unsubscribe = subscribeTradeChanges(changed);
    try {
      await expect(cancelTrade(42, 8)).resolves.toMatchObject({ status: "CANCELLED" });
      await expect(amendTrade(42, { ...input, quantity: 12 }, 8)).resolves.toMatchObject({
        quantity: 12,
      });
      expect(repo.setTradeStatusToCancel).toHaveBeenCalledWith(42, 8);
      expect(repo.updateTrade).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ quantity: 12, recordedById: 8 }),
      );
      expect(changed.mock.calls.map(([event]) => event)).toEqual([
        { type: "trade.changed", tradeId: "TD-00042", action: "cancelled" },
        { type: "trade.changed", tradeId: "TD-00042", action: "amended" },
      ]);
    } finally {
      unsubscribe();
    }
  });
  it("does not publish failed changes", async () => {
    const error = new TradeError({ reason: "trade_not_active", tradeId: 42 });
    vi.mocked(repo.setTradeStatusToCancel).mockRejectedValue(error);
    vi.mocked(repo.updateTrade).mockRejectedValue(error);
    const changed = vi.fn();
    const unsubscribe = subscribeTradeChanges(changed);
    try {
      await expect(cancelTrade(42, 8)).rejects.toBe(error);
      await expect(amendTrade(42, input, 8)).rejects.toBe(error);
      expect(changed).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});

beforeEach(() =>
  vi.mocked(books.selectBookByCode).mockResolvedValue({ code: "EQUITIES_UK", name: "UK Equities" }),
);

beforeEach(() =>
  vi.mocked(counterparties.selectCounterpartyByName).mockResolvedValue({ name: "Bank" }),
);
