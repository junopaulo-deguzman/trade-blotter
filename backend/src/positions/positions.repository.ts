import { db } from "../../db/connection.ts";
export interface OpeningHolding {
  book: string;
  symbol: string;
  quantity: number;
}
export const selectOpeningHoldings = async (): Promise<OpeningHolding[]> =>
  (
    await db.query<OpeningHolding>(`SELECT h.book_code AS book, i.symbol, h.quantity
    FROM opening_holdings h JOIN instruments i ON i.id = h.symbol_id
    ORDER BY h.book_code, i.symbol`)
  ).rows;
