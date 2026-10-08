import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { createAppStore, type AppStore } from "@/store";
import type { OpeningHolding, Trade } from "@/types/api";
import type { TradeUpdatesClient } from "@/store/services";
import { sessionReceived } from "@/store/auth";
import { connectionSlice, tradesApi } from "@/store/api";
import { createInMemoryTradesClient, testTrade } from "@/test-utils/trades-client";
import DashboardPage from "./DashboardPage";

let store: AppStore;
afterEach(() => store?.dispatch(tradesApi.util.resetApiState()));
function setup(
  initialTrades: Trade[] = [
    testTrade,
    { ...testTrade, tradeId: "TD-00002", status: "CANCELLED" },
    { ...testTrade, tradeId: "TD-00003", recordedById: "2" },
  ],
  updatesClient?: TradeUpdatesClient,
  holdings: OpeningHolding[] = [],
) {
  const client = createInMemoryTradesClient(initialTrades, holdings);
  const cancel = vi.spyOn(client, "cancel");
  const amend = vi.spyOn(client, "amend");
  const list = vi.spyOn(client, "list");
  const getTradeById = vi.spyOn(client, "getTradeById");
  store = createAppStore({ client, updatesClient });
  store.dispatch(
    sessionReceived({
      session: {
        accessToken: "a".repeat(43),
        tokenType: "Bearer",
        expiresAt: "2099-01-01T00:00:00Z",
        user: { id: 1, username: "recorder", name: "Recorder" },
      },
    }),
  );
  render(
    <StrictMode>
      <Provider store={store}>
        <DashboardPage />
      </Provider>
    </StrictMode>,
  );
  return { client, cancel, amend, list, getTradeById, user: userEvent.setup() };
}

it("cancels via the row menu and hides cancelled trades with the active-only toggle", async () => {
  const { cancel, user } = setup();
  await screen.findByText("TD-00001");
  await user.click(screen.getByRole("button", { name: "Active only" }));
  expect(screen.queryByText("TD-00002")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Actions for TD-00001" }));
  await user.click(await screen.findByRole("menuitem", { name: "Cancel trade" }));
  await waitFor(() => expect(cancel).toHaveBeenCalledWith("TD-00001"));
  await waitFor(() => expect(screen.queryByText("TD-00001")).toBeNull());
  await user.click(screen.getByRole("button", { name: "Active only" }));
  const row = screen.getByText("TD-00001").closest("tr")!;
  expect(within(row).getByText("CANCELLED")).toBeTruthy();
  expect(row.className).toContain("opacity-50");
});

it("shows accurate realtime connection status and highlights the live state", async () => {
  setup();
  await screen.findByText("TD-00001");

  act(() => store.dispatch(connectionSlice.actions.statusChanged("connecting")));
  expect(screen.getByRole("status").textContent).toContain("Connecting to live updates");

  act(() => store.dispatch(connectionSlice.actions.statusChanged("connected")));
  const liveStatus = screen.getByRole("status");
  expect(liveStatus.textContent).toContain("Live updates");
  expect(liveStatus.className).toContain("text-emerald-700");
  expect(liveStatus.querySelector("svg")?.getAttribute("class")).toContain("animate-pulse");
  expect(liveStatus.querySelector("svg")?.getAttribute("class")).toContain(
    "motion-reduce:animate-none",
  );

  act(() => store.dispatch(connectionSlice.actions.statusChanged("disconnected")));
  expect(screen.getByRole("status").textContent).toContain("Reconnecting to live updates");
});

it("opens the existing form populated for editing and saves through the amendment mutation", async () => {
  const { amend, list, user } = setup();
  await screen.findByText("TD-00001");
  await user.click(screen.getByRole("button", { name: "Actions for TD-00001" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
  const quantity = await screen.findByLabelText("Quantity");
  expect((quantity as HTMLInputElement).value).toBe("1");
  expect((screen.getByLabelText("Symbol") as HTMLInputElement).value).toBe("AAPL");
  expect(screen.queryByRole("button", { name: "Use last price" })).toBeNull();
  await waitFor(() => expect((quantity as HTMLInputElement).disabled).toBe(false));
  await user.clear(quantity);
  await user.type(quantity, "25");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(amend).toHaveBeenCalledWith("TD-00001", expect.objectContaining({ quantity: 25 })),
  );
  const row = screen.getByText("TD-00001").closest("tr")!;
  await waitFor(() => expect(within(row).getByText("25")).toBeTruthy());
  expect(row.className).toContain("animate-trade-edit-highlight");
  expect(list).toHaveBeenCalledTimes(1);
});

it("keeps new dots after the animation and clears them on manual refresh", async () => {
  const { list, user } = setup();
  const row = (await screen.findByText("TD-00001")).closest("tr")!;
  act(() => {
    store.dispatch(connectionSlice.actions.tradeAdded("TD-00001"));
    store.dispatch(connectionSlice.actions.newTradesShown(["TD-00001"]));
  });
  expect(within(row).getByRole("img", { name: "New trade" })).toBeTruthy();
  // JSDOM lacks AnimationEvent, so React listens for the prefixed event.
  fireEvent(row, new Event("webkitAnimationEnd", { bubbles: true }));
  await waitFor(() => expect(row.className).not.toContain("animate-trade-highlight"));
  expect(within(row).getByRole("img", { name: "New trade" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.queryByRole("img", { name: "New trade" })).toBeNull());
  expect(list).toHaveBeenCalledTimes(2);
});

it("allows edit and cancel for another recorder's trade", async () => {
  const { user } = setup();
  await screen.findByText("TD-00003");
  await user.click(screen.getByRole("button", { name: "Actions for TD-00003" }));
  expect(
    (await screen.findByRole("menuitem", { name: "Edit" })).getAttribute("aria-disabled"),
  ).not.toBe("true");
  expect(
    screen.getByRole("menuitem", { name: "Cancel trade" }).getAttribute("aria-disabled"),
  ).not.toBe("true");
});

function setupRealtime(initialTrades: Trade[]) {
  let callbacks!: Parameters<TradeUpdatesClient["subscribe"]>[0];
  const result = setup(initialTrades, {
    subscribe(value) {
      callbacks = value;
      return () => {};
    },
  });
  return {
    ...result,
    status: (status: "connecting" | "connected" | "disconnected") => {
      act(() => callbacks.onStatus(status));
    },
    notify: (trade: Trade, action: "created" | "amended" | "cancelled" = "created") => {
      act(() => callbacks.onChange({ type: "trade.changed", tradeId: trade.tradeId, action }));
    },
  };
}
const manyTrades = Array.from({ length: 30 }, (_, index) => ({
  ...testTrade,
  tradeId: `TD-${String(index + 1).padStart(5, "0")}`,
}));
function visibleIds() {
  return Array.from(
    screen.getByRole("table", { name: "Trade blotter" }).querySelectorAll("tbody tr"),
  ).map((row) => row.querySelector("td")?.textContent);
}

it("keeps page 1 and page 2 stable until reveal without refetching", async () => {
  const { client, notify, list, getTradeById, user } = setupRealtime(manyTrades);
  await screen.findByText("TD-00001");
  const firstPage = visibleIds();
  const first = await client.create({ ...testTrade, symbol: "ZZZ" });
  notify(first);
  await screen.findByRole("button", { name: "Show new trades (1)" });
  expect(visibleIds()).toEqual(firstPage);
  expect(screen.getByText("30 trades")).toBeTruthy();
  expect(screen.queryByText(first.tradeId)).toBeNull();
  expect(store.getState().connection.highlights[first.tradeId]).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  const secondPage = visibleIds();
  expect(secondPage[0]).toBe("TD-00011");
  const second = await client.create({ ...testTrade, symbol: "AAA" });
  notify(second);
  await screen.findByRole("button", { name: "Show new trades (2)" });
  expect(visibleIds()).toEqual(secondPage);
  notify(first);
  await waitFor(() => expect(getTradeById).toHaveBeenCalledTimes(3));
  expect(screen.getByRole("button", { name: "Show new trades (2)" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Show new trades (2)" }));
  expect(screen.getByText("Page 1 of 4")).toBeTruthy();
  expect(visibleIds().slice(0, 2)).toEqual([second.tradeId, first.tradeId]);
  expect(screen.queryByRole("button", { name: /Show new trades/ })).toBeNull();
  expect(screen.getByText(second.tradeId).closest("tr")?.className).toContain(
    "animate-trade-highlight",
  );
  expect(list).toHaveBeenCalledTimes(1);
  expect(getTradeById).toHaveBeenCalledTimes(3);
});

it("counts all arrivals and resets filters/sorting while retaining the page size", async () => {
  const { client, notify, list, getTradeById, user } = setupRealtime(manyTrades);
  await screen.findByText("TD-00001");
  await user.selectOptions(screen.getByLabelText("Rows per page"), "25");
  await user.click(screen.getByRole("button", { name: "Active only" }));
  await user.click(screen.getByRole("button", { name: "Buy side" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-08-18" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-08-18" } });
  await user.click(screen.getByRole("button", { name: "Open additional trade filters" }));
  await user.click(await screen.findByRole("checkbox", { name: "JSMITH" }));
  await user.click(screen.getByRole("button", { name: "Close filters" }));
  await user.click(screen.getByRole("button", { name: "Symbol" }));
  await user.click(screen.getByRole("button", { name: "Next page" }));
  const created = await client.create({
    ...testTrade,
    symbol: "ZZZ",
    side: "SELL",
    tradeTimestamp: "2026-08-19T09:15:23Z",
  });
  await client.cancel(created.tradeId);
  notify(created);
  await user.click(await screen.findByRole("button", { name: "Show new trades (1)" }));
  expect(visibleIds()[0]).toBe(created.tradeId);
  expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  expect((screen.getByLabelText("Rows per page") as HTMLSelectElement).value).toBe("25");
  expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("button", { name: "Active only" }).getAttribute("aria-pressed")).toBe(
    "false",
  );
  expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
  const row = screen.getByText(created.tradeId).closest("tr")!;
  expect(row.className).toContain("opacity-50");
  expect(row.className).not.toContain("animate-trade");
  expect(within(row).getByRole("img", { name: "New trade" })).toBeTruthy();
  expect(list).toHaveBeenCalledTimes(1);
  expect(getTradeById).toHaveBeenCalledTimes(1);
});

it("reveals the latest edits and cancellations to pending trades", async () => {
  const { client, notify, user, list } = setupRealtime([testTrade]);
  await screen.findByText("TD-00001");
  const edited = await client.create(testTrade);
  const cancelled = await client.create(testTrade);
  notify(edited);
  notify(cancelled);
  await screen.findByRole("button", { name: "Show new trades (2)" });
  await client.amend(edited.tradeId, {
    symbol: edited.symbol,
    side: edited.side,
    quantity: 50,
    price: edited.price,
    trader: edited.trader,
    book: edited.book,
    counterparty: edited.counterparty,
    tradeTimestamp: edited.tradeTimestamp,
  });
  await client.cancel(cancelled.tradeId);
  notify(edited, "amended");
  notify(cancelled, "cancelled");
  await waitFor(() =>
    expect(
      tradesApi.endpoints.getTrades
        .select()(store.getState())
        .data?.find((trade) => trade.tradeId === cancelled.tradeId)?.status,
    ).toBe("CANCELLED"),
  );
  await user.click(screen.getByRole("button", { name: "Show new trades (2)" }));
  const row = screen.getByText(edited.tradeId).closest("tr")!;
  expect(within(row).getByText("50")).toBeTruthy();
  expect(row.className).toContain("animate-trade-highlight");
  expect(screen.getByText(cancelled.tradeId).closest("tr")?.className).toContain("opacity-50");
  expect(list).toHaveBeenCalledTimes(1);
});

it("includes pending trades and clears their indicators on successful manual refresh", async () => {
  const { client, notify, user, list } = setupRealtime([testTrade]);
  await screen.findByText("TD-00001");
  const created = await client.create(testTrade);
  notify(created);
  await screen.findByRole("button", { name: "Show new trades (1)" });
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText(created.tradeId);
  expect(screen.queryByRole("button", { name: /Show new trades/ })).toBeNull();
  expect(screen.queryByRole("img", { name: "New trade" })).toBeNull();
  expect(list).toHaveBeenCalledTimes(2);
});

it("keeps pending trades and the reveal button when manual refresh fails", async () => {
  const { client, notify, user, list } = setupRealtime([testTrade]);
  await screen.findByText("TD-00001");
  const created = await client.create(testTrade);
  notify(created);
  await screen.findByRole("button", { name: "Show new trades (1)" });
  list.mockRejectedValueOnce(new Error("Offline"));
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText(/Could not load trades/);
  expect(screen.queryByText(created.tradeId)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Show new trades (1)" }));
  expect(screen.getByText(created.tradeId)).toBeTruthy();
});

it("queues a locally created trade until reveal", async () => {
  const { list, user } = setup();
  await screen.findByText("TD-00001");
  let created!: Trade;
  await act(async () => {
    created = await store.dispatch(tradesApi.endpoints.createTrade.initiate(testTrade)).unwrap();
  });
  expect(screen.queryByText(created.tradeId)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Show new trades (1)" }));
  const row = screen.getByText(created.tradeId).closest("tr")!;
  expect(row.className).toContain("animate-trade-highlight");
  expect(list).toHaveBeenCalledTimes(1);
});

it("keeps pagination valid when cancellation removes the final active page", async () => {
  const { client, notify, user } = setupRealtime(manyTrades.slice(0, 11));
  await screen.findByText("TD-00001");
  await user.click(screen.getByRole("button", { name: "Active only" }));
  await user.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("TD-00011");
  const cancelled = await client.cancel("TD-00011");
  notify(cancelled, "cancelled");
  await screen.findByText("Page 1 of 1");
  expect(visibleIds()).toHaveLength(10);
});

it("keeps drawer drafts on external changes, shows editing presence, and disables save after cancellation", async () => {
  const { client, notify, user } = setupRealtime([testTrade]);
  await screen.findByText("TD-00001");
  await user.click(screen.getByRole("button", { name: "Actions for TD-00001" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
  const quantity = (await screen.findByLabelText("Quantity")) as HTMLInputElement;
  await waitFor(() => expect(quantity.disabled).toBe(false));
  await user.clear(quantity);
  await user.type(quantity, "25");
  act(() => {
    store.dispatch(connectionSlice.actions.connectionIdentified("local"));
    store.dispatch(
      connectionSlice.actions.presenceChanged({
        tradeId: testTrade.tradeId,
        editors: [{ connectionId: "peer", userId: 2, name: "Other editor" }],
      }),
    );
  });
  expect(screen.getByRole("img", { name: "Being edited by Other editor" })).toBeTruthy();
  expect(screen.getByText(/Also being edited by Other editor/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  const changed = await client.amend(testTrade.tradeId, { ...testTrade, quantity: 50 });
  notify(changed, "amended");
  await screen.findByText(/This trade changed while you were editing/);
  expect(quantity.value).toBe("25");
  const cancelled = await client.cancel(testTrade.tradeId);
  notify(cancelled, "cancelled");
  await screen.findByText(/This trade has been cancelled/);
  expect(quantity.value).toBe("25");
  expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it("announces editing while the drawer is open and clears it on close", async () => {
  const setEditingTrade = vi.fn();
  const { user } = setup([testTrade], { setEditingTrade, subscribe: () => () => {} });
  await screen.findByText("TD-00001");
  await user.click(screen.getByRole("button", { name: "Actions for TD-00001" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
  await screen.findByLabelText("Quantity");
  expect(setEditingTrade).toHaveBeenLastCalledWith(testTrade.tradeId);
  await user.click(screen.getByRole("button", { name: "Close trade drawer" }));
  await waitFor(() => expect(setEditingTrade).toHaveBeenLastCalledWith(null));
});

function positionRows() {
  return screen.getAllByRole("article", { name: / position$/ }).map((card) => {
    const metric = (label: string) => within(card).getByText(label).nextElementSibling?.textContent;
    return [
      within(card).getByRole("heading", { level: 3 }).textContent,
      metric("Opening quantity"),
      metric("Bought"),
      metric("Sold"),
      metric("Net traded"),
      metric("Current position"),
    ];
  });
}

it("summarizes all active trades independently of filters and pagination", async () => {
  const { user, list } = setup(manyTrades);
  await screen.findByText("TD-00001");
  await screen.findByRole("article", { name: "AAPL position" });
  expect(positionRows()).toEqual([["AAPL", "0", "30", "0", "+30", "30"]]);
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(positionRows()).toEqual([["AAPL", "0", "30", "0", "+30", "30"]]);
  await user.click(screen.getByRole("button", { name: "Sell side" }));
  expect(screen.queryByText("TD-00001")).toBeNull();
  expect(positionRows()).toEqual([["AAPL", "0", "30", "0", "+30", "30"]]);
  expect(list).toHaveBeenCalledTimes(1);
});

it("updates positions for pending arrivals, symbol amendments and cancellations while collapsed", async () => {
  const { client, notify, user, list, getTradeById } = setupRealtime([testTrade]);
  await screen.findByText("TD-00001");
  await user.click(screen.getByRole("button", { name: "Collapse position summary" }));
  expect(screen.queryByRole("article", { name: "AAPL position" })).toBeNull();
  const created = await client.create({ ...testTrade, quantity: 7 });
  notify(created);
  await screen.findByRole("button", { name: "Show new trades (1)" });
  expect(screen.queryByText(created.tradeId)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Expand position summary" }));
  expect(positionRows()).toEqual([["AAPL", "0", "8", "0", "+8", "8"]]);
  const amended = await client.amend(created.tradeId, {
    ...created,
    symbol: "MSFT",
    book: "US",
    side: "SELL",
    quantity: 3,
  });
  notify(amended, "amended");
  await waitFor(() =>
    expect(positionRows()).toEqual([
      ["AAPL", "0", "1", "0", "+1", "1"],
      ["MSFT", "0", "0", "3", "−3", "−3"],
    ]),
  );
  const cancelled = await client.cancel(created.tradeId);
  notify(cancelled, "cancelled");
  await waitFor(() => expect(positionRows()).toEqual([["AAPL", "0", "1", "0", "+1", "1"]]));
  act(() =>
    store.dispatch(
      connectionSlice.actions.presenceChanged({
        tradeId: testTrade.tradeId,
        editors: [{ connectionId: "peer", userId: 2, name: "Peer" }],
      }),
    ),
  );
  expect(positionRows()).toEqual([["AAPL", "0", "1", "0", "+1", "1"]]);
  expect(list).toHaveBeenCalledTimes(1);
  expect(getTradeById).toHaveBeenCalledTimes(3);
});

it("updates positions through local mutations and reconnect recovery", async () => {
  const { client, status, list } = setupRealtime([testTrade]);
  status("connected");
  await screen.findByText("TD-00001");
  await act(async () => {
    await store
      .dispatch(
        tradesApi.endpoints.amendTrade.initiate({
          tradeId: testTrade.tradeId,
          input: { ...testTrade, quantity: 5 },
        }),
      )
      .unwrap();
  });
  expect(positionRows()).toEqual([["AAPL", "0", "5", "0", "+5", "5"]]);
  status("disconnected");
  await client.create({ ...testTrade, side: "SELL", quantity: 5 });
  status("connected");
  await waitFor(() => expect(positionRows()).toEqual([["AAPL", "0", "5", "5", "0", "0"]]));
  expect(list).toHaveBeenCalledTimes(2);
});

it("shows an empty position summary when all trades are cancelled", async () => {
  setup([{ ...testTrade, status: "CANCELLED" }]);
  await screen.findByText("No holdings or active trades to summarize.");
  expect(screen.queryByRole("article", { name: "AAPL position" })).toBeNull();
});

it("shows symbol cards aggregating opening holdings across books", async () => {
  setup(
    [testTrade, { ...testTrade, tradeId: "TD-00002", book: "US", side: "SELL", quantity: 40 }],
    undefined,
    [
      { book: "UK", symbol: "AAPL", quantity: 500 },
      { book: "US", symbol: "AAPL", quantity: 100 },
      { book: "US", symbol: "MSFT", quantity: 20 },
    ],
  );
  await screen.findByRole("article", { name: "AAPL position" });
  expect(positionRows()).toEqual([
    ["AAPL", "600", "1", "40", "−39", "561"],
    ["MSFT", "20", "0", "0", "0", "20"],
  ]);
});

it("does not show a zero-baseline position when opening holdings fail to load", async () => {
  const { client, user, list } = setup([testTrade], undefined, [
    { book: "UK", symbol: "AAPL", quantity: 500 },
  ]);
  vi.spyOn(client, "openingHoldings").mockRejectedValueOnce(new Error("Offline"));
  await screen.findByText("Could not load opening holdings.");
  expect(screen.queryByRole("article", { name: "AAPL position" })).toBeNull();
  expect(screen.getByRole("table", { name: "Trade blotter" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Retry opening holdings" }));
  await waitFor(() => expect(positionRows()).toEqual([["AAPL", "500", "1", "0", "+1", "501"]]));
  expect(list).toHaveBeenCalledTimes(1);
});

it("shares card selection with the chart and blotter, removing the duplicate symbol filter", async () => {
  const { user, list } = setup([
    testTrade,
    { ...testTrade, tradeId: "TD-00002", symbol: "MSFT", side: "SELL", price: 200 },
    { ...testTrade, tradeId: "TD-00003", symbol: "MSFT", status: "CANCELLED" },
  ]);
  await screen.findByRole("button", { name: "Filter by MSFT" });
  await user.click(screen.getByRole("button", { name: "Buy side" }));
  await user.click(screen.getByRole("button", { name: "Filter by MSFT" }));
  expect(visibleIds()).toEqual(["TD-00002", "TD-00003"]);
  expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Filter by MSFT" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  const legend = screen.getByRole("list", { name: "Price chart legend" });
  expect(legend.textContent).toBe("MSFT");
  await user.click(screen.getByRole("button", { name: "Open additional trade filters" }));
  expect(screen.queryByRole("checkbox", { name: "MSFT" })).toBeNull();
  await user.click(await screen.findByRole("button", { name: "Reset" }));
  await user.click(screen.getByRole("button", { name: "Close filters" }));
  expect(legend.textContent).toBe("AAPLMSFT");
  expect(visibleIds()).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Filter by AAPL" }));
  expect(visibleIds()).toEqual([testTrade.tradeId]);
  await user.click(screen.getByRole("button", { name: "Filter by AAPL" }));
  expect(visibleIds()).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Filter by MSFT" }));
  await user.click(screen.getByRole("button", { name: "All symbols" }));
  expect(visibleIds()).toHaveLength(3);
  expect(list).toHaveBeenCalledTimes(1);
});

it("recovers valuation and chart data after cancelling the latest execution", async () => {
  const { client, notify, getTradeById, list } = setupRealtime([
    { ...testTrade, price: 100, quantity: 2 },
    {
      ...testTrade,
      tradeId: "TD-00002",
      price: 200,
      quantity: 3,
      tradeTimestamp: "2026-08-19T09:00:00Z",
    },
  ]);
  await screen.findByRole("article", { name: "AAPL position" });
  const card = within(screen.getByRole("article", { name: "AAPL position" }));
  expect(card.getByText("$800")).toBeTruthy();
  expect(
    screen
      .getByRole("group", { name: "Execution prices in USD over time" })
      .querySelectorAll("circle[role=button]"),
  ).toHaveLength(2);
  const cancelled = await client.cancel("TD-00002");
  notify(cancelled, "cancelled");
  await waitFor(() => expect(card.getByTitle("$200.00")).toBeTruthy());
  expect(card.getByText("$100.00")).toBeTruthy();
  expect(
    screen
      .getByRole("group", { name: "Execution prices in USD over time" })
      .querySelectorAll("circle[role=button]"),
  ).toHaveLength(1);
  expect(list).toHaveBeenCalledTimes(1);
  expect(getTradeById).toHaveBeenCalledTimes(1);
});

it("filters chart and table by dates without changing positions or valuation, retaining dates on symbol selection", async () => {
  const { user, list } = setup(
    [
      { ...testTrade, quantity: 10, price: 100, tradeTimestamp: "2026-08-18T10:00:00Z" },
      {
        ...testTrade,
        tradeId: "TD-00002",
        quantity: 20,
        price: 200,
        side: "SELL",
        tradeTimestamp: "2026-08-19T10:00:00Z",
      },
      {
        ...testTrade,
        tradeId: "TD-00003",
        quantity: 5,
        price: 300,
        tradeTimestamp: "2026-08-20T10:00:00Z",
      },
      {
        ...testTrade,
        tradeId: "TD-00004",
        quantity: 500,
        price: 999,
        tradeTimestamp: "2026-08-21T10:00:00Z",
      },
      {
        ...testTrade,
        tradeId: "TD-00005",
        symbol: "MSFT",
        price: 400,
        tradeTimestamp: "2026-08-19T10:00:00Z",
      },
    ],
    undefined,
    [{ book: "UK", symbol: "AAPL", quantity: 100 }],
  );
  await screen.findByRole("article", { name: "AAPL position" });
  const dates = within(screen.getByRole("region", { name: "Chart and table date range" }));
  fireEvent.change(dates.getByLabelText("From"), { target: { value: "2026-08-19" } });
  fireEvent.change(dates.getByLabelText("To"), { target: { value: "2026-08-20" } });
  expect(visibleIds()).toEqual(["TD-00002", "TD-00003", "TD-00005"]);
  const card = within(screen.getByRole("article", { name: "AAPL position" }));
  expect(card.getByText("Opening quantity").nextElementSibling?.textContent).toBe("100");
  expect(card.getByText("Current position").nextElementSibling?.textContent).toBe("595");
  expect(card.getByText("$945.79")).toBeTruthy();
  expect(card.queryByRole("status")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Filter by AAPL" }));
  expect((dates.getByLabelText("From") as HTMLInputElement).value).toBe("2026-08-19");
  expect(visibleIds()).toEqual(["TD-00002", "TD-00003"]);
  const chart = within(screen.getByRole("group", { name: "Execution prices in USD over time" }));
  expect(chart.getAllByRole("button")).toHaveLength(2);
  expect(chart.queryByRole("button", { name: /2026-08-18/ })).toBeNull();
  fireEvent.change(dates.getByLabelText("From"), { target: { value: "2026-08-21" } });
  expect(screen.getByRole("alert").textContent).toContain("From must be on or before To");
  expect(screen.getByRole("article", { name: "AAPL position" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Clear dates" }));
  expect(visibleIds()).toEqual(["TD-00001", "TD-00002", "TD-00003", "TD-00004"]);
  expect(list).toHaveBeenCalledTimes(1);
});

it("retains all-date positions and weighted prices when the date range has no executions", async () => {
  setup([{ ...testTrade, price: 100, quantity: 10 }], undefined, [
    { book: "UK", symbol: "AAPL", quantity: 100 },
  ]);
  await screen.findByRole("article", { name: "AAPL position" });
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-08-19" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-08-20" } });
  const card = within(screen.getByRole("article", { name: "AAPL position" }));
  expect(card.getByText("Current position").nextElementSibling?.textContent).toBe("110");
  expect(card.getByText("$100.00")).toBeTruthy();
  expect(screen.getByText("No active executions to chart.")).toBeTruthy();
  expect(screen.getByText("No trades match these filters.")).toBeTruthy();
});

it("refreshes trades and opening holdings from the global controls while preserving date and symbol selection", async () => {
  const { user, client, list } = setup([testTrade]);
  await screen.findByRole("article", { name: "AAPL position" });
  const opening = vi.spyOn(client, "openingHoldings");
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-08-18" } });
  await user.click(screen.getByRole("button", { name: "Filter by AAPL" }));
  const controls = within(screen.getByRole("group", { name: "Dashboard actions" }));
  expect(
    within(screen.getByRole("region", { name: "Trade activity" })).queryByRole("button", {
      name: "Refresh",
    }),
  ).toBeNull();
  await user.click(controls.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(opening).toHaveBeenCalledTimes(1));
  expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-08-18");
  expect(screen.getByRole("button", { name: "Filter by AAPL" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
});

it("offers a live last-price reference for creation without overwriting typed prices", async () => {
  const { client, notify, user, list } = setupRealtime([
    { ...testTrade, price: 100 },
    { ...testTrade, tradeId: "TD-00002", price: 200, tradeTimestamp: "2026-08-19T09:00:00Z" },
    { ...testTrade, tradeId: "TD-00003", symbol: "MSFT", price: 300 },
    {
      ...testTrade,
      tradeId: "TD-00004",
      price: 999,
      status: "CANCELLED",
      tradeTimestamp: "2026-08-20T09:00:00Z",
    },
    { ...testTrade, tradeId: "TD-00005", symbol: "NVDA", status: "CANCELLED" },
  ]);
  await screen.findByRole("article", { name: "AAPL position" });
  await user.click(screen.getByRole("button", { name: /^Create trade$/ }));
  const symbol = await screen.findByLabelText("Symbol");
  await waitFor(() => expect((symbol as HTMLInputElement).disabled).toBe(false));
  await user.type(symbol, "AAPL");
  await user.click(await screen.findByRole("option", { name: /^AAPL$/ }));
  const drawer = within(screen.getByRole("dialog"));
  expect(drawer.getByText("$200.00")).toBeTruthy();
  const price = drawer.getByLabelText("Price") as HTMLInputElement;
  expect(price.value).toBe("");
  await user.type(price, "123");
  const amended = await client.amend("TD-00002", {
    symbol: testTrade.symbol,
    side: testTrade.side,
    quantity: testTrade.quantity,
    trader: testTrade.trader,
    book: testTrade.book,
    counterparty: testTrade.counterparty,
    price: 210,
    tradeTimestamp: "2026-08-19T09:00:00Z",
  });
  notify(amended, "amended");
  await waitFor(() => expect(drawer.getByText("$210.00")).toBeTruthy());
  expect(price.value).toBe("123");
  await user.click(drawer.getByRole("button", { name: "Use last price" }));
  expect(price.value).toBe("210");
  await user.clear(symbol);
  await user.type(symbol, "MSFT");
  await user.click(await screen.findByRole("option", { name: /^MSFT$/ }));
  expect(drawer.getByText("$300.00")).toBeTruthy();
  expect(price.value).toBe("210");
  await user.clear(symbol);
  await user.type(symbol, "NVDA");
  await user.click(await screen.findByRole("option", { name: /^NVDA$/ }));
  expect(drawer.getByText("No active execution price available.")).toBeTruthy();
  expect(drawer.queryByRole("button", { name: "Use last price" })).toBeNull();
  expect(list).toHaveBeenCalledTimes(1);
});
