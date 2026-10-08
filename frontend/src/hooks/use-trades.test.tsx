import { StrictMode, type PropsWithChildren } from "react";
import { Provider } from "react-redux";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createAppStore, type AppStore } from "@/store";
import { tradesApi } from "@/store/api";
import { createInMemoryTradesClient, testTrade } from "@/test-utils/trades-client";
import { useTradeOptions } from "./use-trades";

let store: AppStore;
afterEach(() => {
  for (const query of store.dispatch(tradesApi.util.getRunningQueriesThunk())) query.abort();
  store.dispatch(tradesApi.util.resetApiState());
});
function setup() {
  const client = createInMemoryTradesClient();
  const loadOptions = client.options;
  const options = vi.spyOn(client, "options").mockImplementation(async (signal) => {
    await Promise.resolve();
    signal?.throwIfAborted();
    return loadOptions(signal);
  });
  store = createAppStore({ client });
  const wrapper = ({ children }: PropsWithChildren) => (
    <StrictMode>
      <Provider store={store}>{children}</Provider>
    </StrictMode>
  );
  return { client, options, wrapper };
}

it("loads fresh edit options after creating a trade under StrictMode", async () => {
  const { options, wrapper } = setup();
  const creation = renderHook(({ open }) => useTradeOptions(open), {
    wrapper,
    initialProps: { open: false },
  });
  expect(options).not.toHaveBeenCalled();
  creation.rerender({ open: true });
  await waitFor(() => expect(creation.result.current.isSuccess).toBe(true));
  creation.rerender({ open: false });
  await act(async () => {
    await store
      .dispatch(tradesApi.endpoints.createTrade.initiate({ ...testTrade, book: "NEW_BOOK" }))
      .unwrap();
  });
  const editing = renderHook(() => useTradeOptions(true), { wrapper });
  await waitFor(() => expect(editing.result.current.data?.books).toContain("NEW_BOOK"));
  expect(editing.result.current.isSuccess).toBe(true);
  expect(editing.result.current.isError).toBe(false);
  expect(options).toHaveBeenCalledTimes(2);
});

it("unsubscribes a closing drawer without aborting another drawer's shared request", async () => {
  const { options, wrapper } = setup();
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  options.mockImplementation(async (signal) => {
    await pending;
    signal?.throwIfAborted();
    return { symbols: ["AAPL"], traders: ["JSMITH"], books: ["UK"], counterparties: ["Bank"] };
  });
  const first = renderHook(({ open }) => useTradeOptions(open), {
    wrapper,
    initialProps: { open: true },
  });
  const second = renderHook(() => useTradeOptions(true), { wrapper });
  first.rerender({ open: false });
  expect(first.result.current.isPending).toBe(false);
  expect(options.mock.calls[0][0]?.aborted).toBe(false);
  await act(async () => resolve());
  await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
  expect(options).toHaveBeenCalledTimes(1);
});

it("supports retrying a failed options request", async () => {
  const { options, wrapper } = setup();
  options.mockRejectedValueOnce(new Error("Offline"));
  const { result } = renderHook(() => useTradeOptions(true), { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error?.message).toBe("Offline");
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(options).toHaveBeenCalledTimes(2);
});
