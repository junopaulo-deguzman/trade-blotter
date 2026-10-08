import type { Trade } from "@/types/api";

export interface TradeDateRange {
  fromDate: string;
  toDate: string;
}
export const emptyDateRange: TradeDateRange = { fromDate: "", toDate: "" };
export function executionDate(trade: Trade): string {
  return new Date(trade.tradeTimestamp).toISOString().slice(0, 10);
}
export function inDateRange(trade: Trade, range: TradeDateRange): boolean {
  const date = executionDate(trade);
  return (!range.fromDate || date >= range.fromDate) && (!range.toDate || date <= range.toDate);
}
export function validDateRange(range: TradeDateRange): boolean {
  return !range.fromDate || !range.toDate || range.fromDate <= range.toDate;
}
