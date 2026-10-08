import { db } from "../../db/connection.ts";
export interface Counterparty {
  name: string;
}
export const selectCounterparties = async (): Promise<Counterparty[]> =>
  (await db.query<Counterparty>("SELECT name FROM counterparties ORDER BY name")).rows;
export const selectCounterpartyByName = async (name: string): Promise<Counterparty | null> =>
  (await db.query<Counterparty>("SELECT name FROM counterparties WHERE name = $1", [name]))
    .rows[0] ?? null;
