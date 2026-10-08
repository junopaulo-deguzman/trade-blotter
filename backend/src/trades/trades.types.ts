import { z } from "zod";
import { codeText, requiredText } from "../shared/validation.ts";

export const tradeSides = ["BUY", "SELL"] as const;
export const tradeStatuses = ["ACTIVE", "CANCELLED"] as const;
export type TradeSide = (typeof tradeSides)[number];
export type TradeStatus = (typeof tradeStatuses)[number];
const utcTimestamp = z.iso.datetime().refine((value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1) return false;
  return date.toISOString().slice(0, 19) === value.slice(0, 19);
}, "Invalid UTC execution timestamp.");
export const tradeInputSchema = z.strictObject({
  symbol: codeText,
  trader: codeText,
  side: z.enum(tradeSides),
  quantity: z.number().int().positive().max(2147483647),
  price: z.number().finite().positive(),
  book: requiredText,
  counterparty: requiredText,
  tradeTimestamp: utcTimestamp,
});
export type TradeInput = z.infer<typeof tradeInputSchema>;
const integerQuery = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().safe().nonnegative());
export const tradeListSchema = z.object({
  limit: integerQuery.pipe(z.number().min(1).max(100)).default(100),
  offset: integerQuery.default(0),
});
export const tradeIdSchema = z
  .string()
  .regex(/^(?:TD-)?\d+$/)
  .transform((value) => Number(value.replace(/^TD-/, "")))
  .pipe(z.number().int().min(1).max(2147483647));
export interface Pagination {
  limit: number;
  offset: number;
  total: number;
}
export type TradeListParams = Pick<Pagination, "limit" | "offset">;
export interface TradeResponse {
  tradeId: string;
  symbol: string;
  trader: string;
  side: TradeSide;
  quantity: number;
  price: number;
  book: string;
  counterparty: string;
  status: TradeStatus;
  recordedById: string;
  tradeTimestamp: string;
}
export interface TradeListResponse {
  trades: TradeResponse[];
  pagination: Pagination;
}
export interface TradeListRow {
  id: number;
  symbol_id: number;
  trader_id: number;
  symbol: string;
  trader_code: string;
  side: TradeSide;
  quantity: number;
  price: string;
  book: string;
  counterparty: string;
  status: TradeStatus;
  recorded_by_id: number;
  trade_timestamp: Date;
}
export interface TradeInsertInput {
  symbolId: number;
  traderId: number;
  recordedById: number;
  side: TradeSide;
  quantity: number;
  price: number;
  book: string;
  counterparty: string;
  tradeTimestamp: string;
}

export interface TradeStatusUpdateInput {
  id: number;
  userId: number;
  status: TradeStatus;
}

export interface TradeListResult {
  rows: TradeListRow[];
  total: number;
}
export interface TradeFormOptions {
  symbols: string[];
  traders: string[];
  books: string[];
  counterparties: string[];
}
export interface TradeBookingOptions {
  books: string[];
  counterparties: string[];
}
