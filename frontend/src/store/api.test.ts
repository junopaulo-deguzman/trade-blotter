import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { createInMemoryTradesClient } from "@/test-utils/trades-client";
import type { Trade, TradeInput, TradesClient } from "@/types/api";
import type { TradeUpdatesClient } from "./services";
import { createAppStore, type AppStore } from "./index";
import { tradesApi, connectionSlice } from "./api";

const stores: AppStore[] = [];
function setup(client: TradesClient, updatesClient?: TradeUpdatesClient) {
  const store = createAppStore({ client, updatesClient });
  stores.push(store);
  return store;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const input: TradeInput = {
  symbol: "AAPL",
  trader: "JSMITH",
  side: "BUY",
  quantity: 1,
  price: 10,
  book: "UK",
  counterparty: "Bank",
  tradeTimestamp: "2026-08-18T09:15:23Z",
};
afterEach(() => {
  for (const store of stores.splice(0)) {
    for (const query of store.dispatch(tradesApi.util.getRunningQueriesThunk())) query.abort();
    store.dispatch(tradesApi.util.resetApiState());
  }
});

it("fetches only affected trades and cleans up the shared subscription", async () => {
  let callbacks!: Parameters<TradeUpdatesClient["subscribe"]>[0];
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((value) => {
    callbacks = value;
    return unsubscribe;
  });
  const client = createInMemoryTradesClient();
  const old = (await client.list())[0];
  const created = { ...old, tradeId: "NEW" };
  const getTradeById = vi
    .fn()
    .mockResolvedValueOnce(created)
    .mockResolvedValueOnce({ ...old, status: "CANCELLED" })
    .mockResolvedValueOnce({ ...created, quantity: 12 });
  const list = vi.spyOn(client, "list");
  const store = setup({ ...client, getTradeById }, { subscribe });
  await store.dispatch(tradesApi.endpoints.getTrades.initiate());
  await store.dispatch(tradesApi.endpoints.getTrades.initiate());
  expect(subscribe).toHaveBeenCalledTimes(1);
  callbacks.onChange({ type: "trade.changed", tradeId: "NEW", action: "created" });
  await waitFor(() =>
    expect(tradesApi.endpoints.getTrades.select()(store.getState()).data?.[0]).toEqual(created),
  );
  expect(store.getState().connection.newTradeIds).toContain("NEW");
  callbacks.onChange({ type: "trade.changed", tradeId: old.tradeId, action: "cancelled" });
  await waitFor(() =>
    expect(tradesApi.endpoints.getTrades.select()(store.getState()).data?.[1].status).toBe(
      "CANCELLED",
    ),
  );
  expect(getTradeById.mock.calls.map(([id]) => id)).toEqual(["NEW", old.tradeId]);
  callbacks.onChange({ type: "trade.changed", tradeId: "NEW", action: "amended" });
  await waitFor(() =>
    expect(tradesApi.endpoints.getTrades.select()(store.getState()).data?.[0].quantity).toBe(12),
  );
  expect(store.getState().connection.pendingTradeIds).toEqual(["NEW"]);
  expect(store.getState().connection.highlights.NEW).toBeUndefined();
  expect(list).toHaveBeenCalledTimes(1);
  callbacks.onStatus("connected");
  callbacks.onStatus("disconnected");
  callbacks.onStatus("connected");
  await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
  expect(getTradeById).toHaveBeenCalledTimes(3);
  store.dispatch(tradesApi.util.resetApiState());
  await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
});

it("reuses the in-flight initial list when the first socket connects", async () => {
  const client = createInMemoryTradesClient();
  const rows = await client.list();
  const read = deferred<Trade[]>();
  const list = vi.fn().mockReturnValueOnce(read.promise).mockResolvedValue(rows);
  let callbacks!: Parameters<TradeUpdatesClient["subscribe"]>[0];
  const store = setup(
    { ...client, list },
    {
      subscribe(value) {
        callbacks = value;
        return () => {};
      },
    },
  );
  const first = store.dispatch(tradesApi.endpoints.getTrades.initiate());
  callbacks.onStatus("connected");
  read.resolve(rows);
  await first;
  // Allow RTK Query's delayed invalidation queue to drain.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(list).toHaveBeenCalledTimes(1);
  callbacks.onStatus("connected");
  expect(list).toHaveBeenCalledTimes(1);
  callbacks.onStatus("disconnected");
  const missed = await client.create(input);
  list.mockResolvedValue(await client.list());
  callbacks.onStatus("connected");
  await waitFor(() => {
    expect(list).toHaveBeenCalledTimes(2);
    expect(tradesApi.endpoints.getTrades.select()(store.getState()).data).toEqual(
      expect.arrayContaining([missed]),
    );
  });
});

it("schedules reconnect recovery even while the initial read is pending", async () => {
  const client = createInMemoryTradesClient();
  const old = await client.list();
  const read = deferred<Trade[]>();
  const list = vi
    .fn()
    .mockReturnValueOnce(read.promise)
    .mockImplementation(() => client.list());
  let callbacks!: Parameters<TradeUpdatesClient["subscribe"]>[0];
  const store = setup(
    { ...client, list },
    {
      subscribe(value) {
        callbacks = value;
        return () => {};
      },
    },
  );
  const first = store.dispatch(tradesApi.endpoints.getTrades.initiate());
  callbacks.onStatus("connected");
  callbacks.onStatus("disconnected");
  const missed = await client.create(input);
  callbacks.onStatus("connected");
  read.resolve(old);
  await first;
  await waitFor(() => {
    expect(list).toHaveBeenCalledTimes(2);
    expect(tradesApi.endpoints.getTrades.select()(store.getState()).data).toEqual(
      expect.arrayContaining([missed]),
    );
  });
});

it("keeps a confirmed save when an older list response finishes", async () => {
  const client = createInMemoryTradesClient();
  const old = await client.list();
  const read = deferred<Trade[]>();
  const list = vi
    .fn()
    .mockResolvedValueOnce(old)
    .mockReturnValueOnce(read.promise)
    .mockRejectedValue(new Error("Offline"));
  const store = setup({ ...client, list });
  await store.dispatch(tradesApi.endpoints.getTrades.initiate());
  const refresh = store.dispatch(
    tradesApi.endpoints.getTrades.initiate(undefined, { forceRefetch: true }),
  );
  const created = await store.dispatch(tradesApi.endpoints.createTrade.initiate(input)).unwrap();
  expect(tradesApi.endpoints.getTrades.select()(store.getState()).data?.[0]).toEqual(created);
  read.resolve(old);
  await refresh;
  expect(store.getState().connection.pendingTradeIds).toEqual([created.tradeId]);
  expect(list).toHaveBeenCalledTimes(2);
  expect(tradesApi.endpoints.getTrades.select()(store.getState()).data?.[0]).toEqual(created);
});

it("caches and queues a saved trade even if the initial list read is still pending", async () => {
  const client = createInMemoryTradesClient();
  const read = deferred<Trade[]>();
  const list = vi
    .fn()
    .mockReturnValueOnce(read.promise)
    .mockImplementation(() => client.list());
  const store = setup({ ...client, list });
  const first = store.dispatch(tradesApi.endpoints.getTrades.initiate());
  const created = await store.dispatch(tradesApi.endpoints.createTrade.initiate(input)).unwrap();
  expect(tradesApi.endpoints.getTrades.select()(store.getState()).data?.[0]).toEqual(created);
  expect(store.getState().connection.pendingTradeIds).toEqual([created.tradeId]);
  read.resolve([]);
  await first;
  expect(list).toHaveBeenCalledTimes(1);
  expect(tradesApi.endpoints.getTrades.select()(store.getState()).data?.[0]).toEqual(created);
});

it("updates a single trade on local edit/cancel and retains the new indicator until refresh", async () => {
  const client = createInMemoryTradesClient();
  const list = vi.spyOn(client, "list");
  const store = setup(client);
  await store.dispatch(tradesApi.endpoints.getTrades.initiate());
  const created = await store.dispatch(tradesApi.endpoints.createTrade.initiate(input)).unwrap();
  store.dispatch(connectionSlice.actions.newTradesShown([created.tradeId]));
  store.dispatch(connectionSlice.actions.highlightCleared(created.tradeId));
  expect(store.getState().connection.newTradeIds).toContain(created.tradeId);
  expect(store.getState().connection.highlights[created.tradeId]).toBeUndefined();
  await store
    .dispatch(
      tradesApi.endpoints.amendTrade.initiate({
        tradeId: created.tradeId,
        input: { ...input, quantity: 25 },
      }),
    )
    .unwrap();
  expect(tradesApi.endpoints.getTrades.select()(store.getState()).data?.[0].quantity).toBe(25);
  expect(store.getState().connection.highlights[created.tradeId]).toBe("amended");
  await store.dispatch(tradesApi.endpoints.cancelTrade.initiate(created.tradeId)).unwrap();
  expect(tradesApi.endpoints.getTrades.select()(store.getState()).data?.[0].status).toBe(
    "CANCELLED",
  );
  expect(list).toHaveBeenCalledTimes(1);
  await store.dispatch(tradesApi.endpoints.getTrades.initiate(undefined, { forceRefetch: true }));
  expect(list).toHaveBeenCalledTimes(2);
  expect(store.getState().connection.newTradeIds).toEqual([]);
  expect(store.getState().connection.pendingTradeIds).toEqual([]);
  expect(store.getState().connection.highlights).toEqual({});
});

it("keeps the new indicator if refresh fails and preserves the list if a mutation fails", async () => {
  const client = createInMemoryTradesClient();
  const store = setup({
    ...client,
    list: vi.fn().mockResolvedValueOnce([]).mockRejectedValue(new Error("Offline")),
    cancel: vi.fn().mockRejectedValue(new Error("Forbidden")),
  });
  await store.dispatch(tradesApi.endpoints.getTrades.initiate());
  const created = await store.dispatch(tradesApi.endpoints.createTrade.initiate(input)).unwrap();
  await store.dispatch(tradesApi.endpoints.getTrades.initiate(undefined, { forceRefetch: true }));
  expect(store.getState().connection.newTradeIds).toContain(created.tradeId);
  expect(store.getState().connection.pendingTradeIds).toEqual([created.tradeId]);
  await expect(
    store.dispatch(tradesApi.endpoints.cancelTrade.initiate(created.tradeId)).unwrap(),
  ).rejects.toMatchObject({ message: "Forbidden" });
  expect(tradesApi.endpoints.getTrades.select()(store.getState()).data?.[0]).toEqual(created);
});

it("does not requeue duplicate creation events after reveal or refresh", async () => {
  let callbacks!: Parameters<TradeUpdatesClient["subscribe"]>[0];
  const client = createInMemoryTradesClient();
  const getTradeById = vi.spyOn(client, "getTradeById");
  const store = setup(client, {
    subscribe(value) {
      callbacks = value;
      return () => {};
    },
  });
  await store.dispatch(tradesApi.endpoints.getTrades.initiate());
  const created = await store.dispatch(tradesApi.endpoints.createTrade.initiate(input)).unwrap();
  const event = { type: "trade.changed", tradeId: created.tradeId, action: "created" } as const;
  callbacks.onChange(event);
  await waitFor(() => expect(getTradeById).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      tradesApi.endpoints.getTradeById.select(created.tradeId)(store.getState()).isSuccess,
    ).toBe(true),
  );
  expect(store.getState().connection.pendingTradeIds).toEqual([created.tradeId]);
  store.dispatch(connectionSlice.actions.newTradesShown([created.tradeId]));
  callbacks.onChange(event);
  await waitFor(() => expect(getTradeById).toHaveBeenCalledTimes(2));
  expect(store.getState().connection.pendingTradeIds).toEqual([]);
  await store.dispatch(tradesApi.endpoints.getTrades.initiate(undefined, { forceRefetch: true }));
  callbacks.onChange(event);
  await waitFor(() => expect(getTradeById).toHaveBeenCalledTimes(3));
  expect(store.getState().connection.pendingTradeIds).toEqual([]);
  expect(store.getState().connection.newTradeIds).toEqual([]);
});

it("recovers missed changes on reconnect and presence never fetches trades", async () => {
  let callbacks!: Parameters<TradeUpdatesClient["subscribe"]>[0];
  const client = createInMemoryTradesClient();
  const list = vi.spyOn(client, "list");
  const getTradeById = vi.spyOn(client, "getTradeById");
  const store = setup(client, {
    subscribe(value) {
      callbacks = value;
      return () => {};
    },
  });
  await store.dispatch(tradesApi.endpoints.getTrades.initiate());
  const missed = await client.create(input);
  callbacks.onReady?.("local");
  callbacks.onPresence?.({
    type: "editing.snapshot",
    trades: [
      { tradeId: missed.tradeId, editors: [{ connectionId: "peer", userId: 2, name: "Peer" }] },
    ],
  });
  expect(list).toHaveBeenCalledTimes(1);
  expect(getTradeById).not.toHaveBeenCalled();
  expect(store.getState().connection.editors[missed.tradeId][0].name).toBe("Peer");
  callbacks.onStatus("connected");
  await waitFor(() =>
    expect(
      tradesApi.endpoints.getTrades
        .select()(store.getState())
        .data?.some((trade) => trade.tradeId === missed.tradeId),
    ).toBe(true),
  );
  const calls = list.mock.calls.length;
  callbacks.onStatus("connected");
  expect(list).toHaveBeenCalledTimes(calls);
  callbacks.onStatus("disconnected");
  expect(store.getState().connection.editors).toEqual({});
});

it("finishes recovery with a fresh read when a confirmed save overlaps the snapshot", async () => {
  const client = createInMemoryTradesClient();
  const old = await client.list();
  const read = deferred<Trade[]>();
  const missed = await client.create(input);
  const list = vi
    .spyOn(client, "list")
    .mockResolvedValueOnce(old)
    .mockReturnValueOnce(read.promise);
  let callbacks!: Parameters<TradeUpdatesClient["subscribe"]>[0];
  const store = setup(client, {
    subscribe(value) {
      callbacks = value;
      return () => {};
    },
  });
  await store.dispatch(tradesApi.endpoints.getTrades.initiate());
  callbacks.onStatus("connected");
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  const saved = await store.dispatch(tradesApi.endpoints.createTrade.initiate(input)).unwrap();
  read.resolve(old);
  await waitFor(() => {
    const trades = tradesApi.endpoints.getTrades.select()(store.getState()).data;
    expect(trades?.some((trade) => trade.tradeId === missed.tradeId)).toBe(true);
    expect(trades?.some((trade) => trade.tradeId === saved.tradeId)).toBe(true);
  });
  expect(list).toHaveBeenCalledTimes(3);
});
