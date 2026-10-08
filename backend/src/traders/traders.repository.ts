import { db } from "../../db/connection.ts";
import type { TraderRow } from "./traders.types.ts";
export const selectTraders = async (): Promise<TraderRow[]> =>
  (await db.query<TraderRow>("SELECT id, trader_code, name FROM traders ORDER BY trader_code"))
    .rows;
export const selectTraderByCode = async (code: string): Promise<TraderRow | null> =>
  (
    await db.query<TraderRow>("SELECT id, trader_code, name FROM traders WHERE trader_code = $1", [
      code,
    ])
  ).rows[0] ?? null;
