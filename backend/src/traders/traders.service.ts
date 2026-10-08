import { selectTraders, selectTraderByCode } from "./traders.repository.ts";
import type { TraderResponse } from "./traders.types.ts";
export const getTraders = async (): Promise<TraderResponse[]> =>
  (await selectTraders()).map((row) => ({ traderCode: row.trader_code, traderName: row.name }));
export const getTraderByCode = selectTraderByCode;
