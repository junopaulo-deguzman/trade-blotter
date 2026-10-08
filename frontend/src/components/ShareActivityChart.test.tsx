import { expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ShareActivityChart, { dailyShareActivity } from "./ShareActivityChart";
import { testTrade } from "@/test-utils/trades-client";
import { emptyDateRange } from "@/lib/trade-date-range";

const trades = [
  { ...testTrade, quantity: 100 },
  { ...testTrade, tradeId: "2", quantity: 100, side: "SELL" as const },
  { ...testTrade, tradeId: "3", symbol: "MSFT", quantity: 50 },
  { ...testTrade, tradeId: "4", quantity: 999, status: "CANCELLED" as const },
  { ...testTrade, tradeId: "5", quantity: 20, tradeTimestamp: "2026-08-19T09:00:00Z" },
];
it("retains gross activity when net change is zero and applies symbol and inclusive UTC dates", () => {
  expect(
    dailyShareActivity(trades, "AAPL", { fromDate: "2026-08-18", toDate: "2026-08-18" }),
  ).toEqual([{ date: "2026-08-18", bought: 100, sold: 100, count: 2 }]);
  expect(dailyShareActivity(trades, null, emptyDateRange)).toEqual([
    { date: "2026-08-18", bought: 150, sold: 100, count: 3 },
    { date: "2026-08-19", bought: 20, sold: 0, count: 1 },
  ]);
});
it("supports keyboard inspection and recalculates selected daily activity after amendments and cancellation", () => {
  const view = render(<ShareActivityChart trades={trades} selectedSymbol="AAPL" />);
  const chart = within(screen.getByRole("group", { name: "Daily shares bought and sold" }));
  const points = chart.getAllByRole("button");
  fireEvent.focus(points[0]);
  expect(screen.getByText(/2026-08-18: Bought 100, sold 100, net 0 shares/)).toBeTruthy();
  fireEvent.keyDown(points[0], { key: "ArrowRight" });
  expect(document.activeElement).toBe(points[1]);
  expect(screen.getByText(/2026-08-19: Bought 20, sold 0, net 20 shares/)).toBeTruthy();
  view.rerender(
    <ShareActivityChart
      trades={trades.map((trade) => (trade.tradeId === "5" ? { ...trade, quantity: 30 } : trade))}
      selectedSymbol="AAPL"
    />,
  );
  expect(screen.getByText(/2026-08-19: Bought 30, sold 0, net 30 shares/)).toBeTruthy();
  view.rerender(
    <ShareActivityChart
      trades={trades.map((trade) => ({ ...trade, status: "CANCELLED" }))}
      selectedSymbol="AAPL"
    />,
  );
  expect(screen.getByText("No active share activity to chart.")).toBeTruthy();
});
