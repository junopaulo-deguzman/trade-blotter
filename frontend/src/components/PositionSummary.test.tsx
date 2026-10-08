import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import PositionSummary from "./PositionSummary";
import { testTrade } from "@/test-utils/trades-client";
vi.mock("@/store/api", () => ({
  tradesApi: {
    useGetOpeningHoldingsQuery: () => ({ data: [{ book: "UK", symbol: "MSFT", quantity: 50 }] }),
  },
}));
afterEach(() => vi.useRealTimers());

it("shows signed quantity deltas for four seconds, without treating price edits as quantity changes", () => {
  vi.useFakeTimers();
  const props = { selectedSymbol: null, onSelectSymbol: vi.fn() };
  const view = render(<PositionSummary {...props} trades={[testTrade]} />);
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(<PositionSummary {...props} trades={[{ ...testTrade, quantity: 11 }]} />);
  expect(screen.getByRole("status").textContent).toBe("+10 shares");
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  view.rerender(<PositionSummary {...props} trades={[{ ...testTrade, quantity: 8 }]} />);
  expect(screen.getByRole("status").textContent).toBe("−3 shares");
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  view.rerender(
    <PositionSummary {...props} trades={[{ ...testTrade, quantity: 8, price: 200 }]} />,
  );
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.queryByRole("status")).toBeNull();
  const aapl = within(screen.getByRole("article", { name: "AAPL position" }));
  expect(aapl.getByText("$1.6K")).toBeTruthy();
  expect(
    within(screen.getByRole("article", { name: "MSFT position" })).getAllByText("Unavailable"),
  ).toHaveLength(2);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
