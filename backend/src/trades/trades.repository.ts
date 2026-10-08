import { TradeError } from "./trades.errors.ts";
import type { PoolClient } from "pg";
import { db } from "../../db/connection.ts";
import { transaction } from "../shared/transaction.ts";
import type {
  TradeListRow,
  TradeListParams,
  TradeListResult,
  TradeInsertInput,
  TradeBookingOptions,
} from "./trades.types.ts";

const selectTrade = `
  SELECT tr.id, tr.symbol_id, tr.trader_id, i.symbol, t.trader_code,
  tr.side, tr.quantity, tr.price, tr.book, tr.counterparty, tr.status,
  tr.recorded_by_id, tr.trade_timestamp
  FROM trades tr
  JOIN instruments i ON tr.symbol_id = i.id
  JOIN traders t ON tr.trader_id = t.id`;

export const listTrades = async ({ limit, offset }: TradeListParams): Promise<TradeListResult> =>
  transaction(async (client) => {
    const count = await client.query<{ total: string }>("SELECT COUNT(*) AS total FROM trades");
    const result = await client.query<TradeListRow>(
      `${selectTrade} ORDER BY tr.trade_timestamp DESC, tr.id DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return { rows: result.rows, total: Number(count.rows[0]!.total) };
  }, true);

export const getTradeById = async (
  id: number,
  client?: PoolClient,
): Promise<TradeListRow | null> => {
  const result = await (client ?? db).query<TradeListRow>(`${selectTrade} WHERE tr.id = $1`, [id]);
  return result.rows[0] ?? null;
};

export const insertTrade = async (trade: TradeInsertInput): Promise<TradeListRow> => {
  return transaction(async (client) => {
    const result = await client.query<{ id: number }>(
      `INSERT INTO trades
        (symbol_id, trader_id, recorded_by_id, side, quantity, price, book, counterparty, trade_timestamp, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE') RETURNING id`,
      [
        trade.symbolId,
        trade.traderId,
        trade.recordedById,
        trade.side,
        trade.quantity,
        trade.price,
        trade.book,
        trade.counterparty,
        trade.tradeTimestamp,
      ],
    );
    const row = await getTradeById(result.rows[0]!.id, client);
    if (!row) throw new Error("Inserted trade could not be read");
    return row;
  });
};

/** Lock before checking status so cancellation cannot be overwritten by an amendment. */
async function requireActiveTrade(client: PoolClient, id: number) {
  const result = await client.query<{ recorded_by_id: number; status: string }>(
    "SELECT recorded_by_id, status FROM trades WHERE id = $1 FOR UPDATE",
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new TradeError({ reason: "trade_not_found", tradeId: id });
  if (row.status !== "ACTIVE") throw new TradeError({ reason: "trade_not_active", tradeId: id });
}

export const setTradeStatusToCancel = async (id: number, _userId: number): Promise<TradeListRow> =>
  transaction(async (client) => {
    await requireActiveTrade(client, id);
    await client.query("UPDATE trades SET status = 'CANCELLED' WHERE id = $1", [id]);
    const row = await getTradeById(id, client);
    if (!row) throw new Error("Cancelled trade could not be read");
    return row;
  });

export const updateTrade = async (id: number, trade: TradeInsertInput): Promise<TradeListRow> =>
  transaction(async (client) => {
    await requireActiveTrade(client, id);
    await client.query(
      `UPDATE trades SET symbol_id = $2, trader_id = $3, side = $4, quantity = $5,
      price = $6, book = $7, counterparty = $8, trade_timestamp = $9 WHERE id = $1`,
      [
        id,
        trade.symbolId,
        trade.traderId,
        trade.side,
        trade.quantity,
        trade.price,
        trade.book,
        trade.counterparty,
        trade.tradeTimestamp,
      ],
    );
    const row = await getTradeById(id, client);
    if (!row) throw new Error("Amended trade could not be read");
    return row;
  });

export const selectBookingOptions = async (): Promise<TradeBookingOptions> => {
  const result = await db.query<{
    books: string[];
    counterparties: string[];
  }>(`SELECT
    ARRAY(SELECT code FROM books ORDER BY code) AS books,
    ARRAY(SELECT name FROM counterparties ORDER BY name) AS counterparties`);
  return result.rows[0]!;
};
