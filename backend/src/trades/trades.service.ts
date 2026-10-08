import { DatabaseError } from "pg";
import type {
  TradeListParams,
  TradeResponse,
  TradeListResponse,
  TradeListRow,
  TradeInput,
  TradeFormOptions,
} from "./trades.types.ts";
import {
  listTrades,
  getTradeById,
  insertTrade,
  selectBookingOptions,
  setTradeStatusToCancel,
  updateTrade,
} from "./trades.repository.ts";
import { getInstrumentBySymbol, getInstruments } from "../instruments/instruments.service.ts";
import { getTraderByCode, getTraders } from "../traders/traders.service.ts";
import { TradeError } from "./trades.errors.ts";

import { selectCounterpartyByName } from "../counterparties/counterparties.repository.ts";
import { selectBookByCode } from "../books/books.repository.ts";
import { publishTradeChanged } from "../ws/events.ts";

const formatTradeId = (id: number) => `TD-${String(id).padStart(5, "0")}`;
const toTradeResponse = (row: TradeListRow): TradeResponse => ({
  tradeId: formatTradeId(row.id),
  symbol: row.symbol,
  trader: row.trader_code,
  quantity: row.quantity,
  price: Number(row.price),
  tradeTimestamp: row.trade_timestamp.toISOString(),
  side: row.side,
  status: row.status,
  book: row.book,
  counterparty: row.counterparty,
  recordedById: String(row.recorded_by_id),
});

export const getTrades = async (params: TradeListParams): Promise<TradeListResponse> => {
  const { rows, total } = await listTrades(params);
  return { trades: rows.map(toTradeResponse), pagination: { ...params, total } };
};

export const getTrade = async (id: number): Promise<TradeResponse> => {
  const row = await getTradeById(id);
  if (!row) throw new TradeError({ reason: "trade_not_found", tradeId: id });
  return toTradeResponse(row);
};

const saveTrade = async (
  input: TradeInput,
  recordedById: number,
  id?: number,
): Promise<TradeResponse> => {
  const instrument = await getInstrumentBySymbol(input.symbol);
  if (!instrument) {
    throw new TradeError({ reason: "unknown_instrument", symbol: input.symbol });
  }
  const trader = await getTraderByCode(input.trader);
  if (!trader) {
    throw new TradeError({ reason: "unknown_trader", traderCode: input.trader });
  }
  if (!(await selectBookByCode(input.book)))
    throw new TradeError({ reason: "unknown_book", book: input.book });
  if (!(await selectCounterpartyByName(input.counterparty)))
    throw new TradeError({ reason: "unknown_counterparty", counterparty: input.counterparty });
  try {
    const values = {
      symbolId: instrument.id,
      traderId: trader.id,
      recordedById,
      side: input.side,
      quantity: input.quantity,
      price: input.price,
      book: input.book,
      counterparty: input.counterparty,
      tradeTimestamp: input.tradeTimestamp,
    };
    const row = await (id === undefined ? insertTrade(values) : updateTrade(id, values));
    const trade = toTradeResponse(row);
    publishTradeChanged({
      tradeId: trade.tradeId,
      action: id === undefined ? "created" : "amended",
    });
    return trade;
  } catch (error) {
    // A reference can be deleted after the lookups but before persistence.
    if (error instanceof DatabaseError && error.code === "23503") {
      switch (error.constraint) {
        case "fk_trade_symbol_id":
          throw new TradeError({ reason: "unknown_instrument", symbol: input.symbol });
        case "fk_trade_trader_id":
          throw new TradeError({ reason: "unknown_trader", traderCode: input.trader });
        case "fk_trade_counterparty_name":
          throw new TradeError({
            reason: "unknown_counterparty",
            counterparty: input.counterparty,
          });
        case "fk_trade_book_code":
          throw new TradeError({ reason: "unknown_book", book: input.book });
        case "fk_trade_recorded_by_id":
          throw new TradeError({ reason: "recorder_not_found", recorderId: recordedById });
      }
    }
    throw error;
  }
};

export const createTrade = (input: TradeInput, recordedById: number) =>
  saveTrade(input, recordedById);
export const amendTrade = (id: number, input: TradeInput, userId: number) =>
  saveTrade(input, userId, id);

export const cancelTrade = async (id: number, userId: number): Promise<TradeResponse> => {
  const row = await setTradeStatusToCancel(id, userId);
  const trade = toTradeResponse(row);
  publishTradeChanged({ tradeId: trade.tradeId, action: "cancelled" });
  return trade;
};

export const getTradeOptions = async (): Promise<TradeFormOptions> => {
  const [instruments, traders, booking] = await Promise.all([
    getInstruments(),
    getTraders(),
    selectBookingOptions(),
  ]);
  return {
    symbols: instruments.map((item) => item.symbol),
    traders: traders.map((item) => item.traderCode),
    ...booking,
  };
};
