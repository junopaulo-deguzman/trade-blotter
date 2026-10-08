import { db } from "../../db/connection.ts";
import type { Instrument } from "./instruments.types.ts";
export const selectInstruments = async (): Promise<Instrument[]> =>
  (await db.query<Instrument>("SELECT id, symbol, name FROM instruments ORDER BY symbol")).rows;
export const selectInstrumentBySymbol = async (symbol: string): Promise<Instrument | null> =>
  (
    await db.query<Instrument>("SELECT id, symbol, name FROM instruments WHERE symbol = $1", [
      symbol,
    ])
  ).rows[0] ?? null;
