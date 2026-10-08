import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import ExecutionPriceChart from "./ExecutionPriceChart";
import { testTrade } from "@/test-utils/trades-client";

it("exposes chronological point details through keyboard navigation and refreshes amended values", () => {
  const trades = [
    testTrade,
    { ...testTrade, tradeId: "TD-00002", price: 200, tradeTimestamp: "2026-08-19T09:00:00Z" },
  ];
  const view = render(<ExecutionPriceChart trades={trades} selectedSymbol={null} />);
  const chart = within(screen.getByRole("group", { name: "Execution prices in USD over time" }));
  const points = chart.getAllByRole("button");
  fireEvent.focus(points[0]);
  fireEvent.keyDown(points[0], { key: "ArrowRight" });
  expect(document.activeElement).toBe(points[1]);
  expect(
    screen.getByText(/AAPL · 2026-08-19 · \$200.00 weighted average · 1 executions · 1 shares/),
  ).toBeTruthy();
  view.rerender(
    <ExecutionPriceChart
      trades={[trades[0], { ...trades[1], price: 210 }]}
      selectedSymbol={null}
    />,
  );
  expect(screen.getByText(/\$210.00 weighted average/)).toBeTruthy();
  view.rerender(<ExecutionPriceChart trades={[]} selectedSymbol={null} />);
  expect(screen.getByText("No active executions to chart.")).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Execution prices in USD over time" })).toBeNull();
});

afterEach(() => vi.useRealTimers());
it("tracks the nearest day across the plot, coalesces pointer moves, and cancels pending work on leave", () => {
  vi.useFakeTimers();
  render(
    <ExecutionPriceChart
      trades={[
        testTrade,
        { ...testTrade, tradeId: "2", price: 200, tradeTimestamp: "2026-08-19T09:00:00Z" },
      ]}
      selectedSymbol={null}
    />,
  );
  const svg = screen.getByRole("group", { name: "Execution prices in USD over time" });
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 940,
    height: 240,
    right: 940,
    bottom: 240,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  fireEvent(svg, new MouseEvent("pointermove", { bubbles: true, clientX: 70, clientY: 100 }));
  fireEvent(svg, new MouseEvent("pointermove", { bubbles: true, clientX: 900, clientY: 100 }));
  expect(screen.queryByText(/200.00 weighted average · 1 executions/)).toBeNull();
  act(() => {
    vi.advanceTimersByTime(20);
  });
  expect(screen.getByText(/200.00 weighted average · 1 executions/)).toBeTruthy();
  fireEvent(svg, new MouseEvent("pointermove", { bubbles: true, clientX: 70, clientY: 100 }));
  fireEvent.pointerLeave(svg);
  act(() => {
    vi.advanceTimersByTime(20);
  });
  expect(screen.queryByText(/weighted average · 1 executions/)).toBeNull();
});
