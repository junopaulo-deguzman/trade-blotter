import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { createTradeUpdatesClient } from "./trade-updates-client";

afterEach(() => vi.unstubAllGlobals());

it("uses a bearer ticket, forwards supported events, and closes when the session ends", async () => {
  let socket!: Socket;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send = vi.fn();
    onmessage?: (event: { data: string }) => void;
    onclose?: (event: { code: number }) => void;
    close = vi.fn();
    constructor(readonly url: URL) {
      socket = this;
    }
  }
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ticket: "single-use" }),
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("WebSocket", Socket);
  let token: string | null = "session";
  let synchronize!: () => void;
  const unwatch = vi.fn();
  const client = createTradeUpdatesClient("/api", { getAccessToken: () => token }, (listener) => {
    synchronize = listener;
    return unwatch;
  });
  const onChange = vi.fn();
  const onStatus = vi.fn();
  const onPresence = vi.fn();
  const stop = client.subscribe({ onChange, onStatus, onPresence });
  client.setEditingTrade?.("TD-00001");
  await waitFor(() => expect(socket).toBeDefined());
  expect(fetch.mock.calls[0][0]).toBe("/api/ws/ticket");
  expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer session");
  expect(socket.url.pathname).toBe("/api/ws");
  expect(socket.url.searchParams.get("ticket")).toBe("single-use");
  socket.onmessage?.({ data: JSON.stringify({ type: "connection.ready" }) });
  expect(onStatus).toHaveBeenLastCalledWith("connected");
  expect(socket.send).toHaveBeenLastCalledWith(
    JSON.stringify({ type: "trade.editing", tradeId: "TD-00001" }),
  );
  socket.onmessage?.({ data: JSON.stringify({ type: "editing.snapshot", trades: [] }) });
  expect(onPresence).toHaveBeenCalledWith({ type: "editing.snapshot", trades: [] });
  client.setEditingTrade?.(null);
  expect(socket.send).toHaveBeenLastCalledWith(
    JSON.stringify({ type: "trade.editing", tradeId: null }),
  );
  for (const action of ["created", "cancelled", "amended"]) {
    socket.onmessage?.({
      data: JSON.stringify({ type: "trade.changed", tradeId: "TD-00001", action }),
    });
  }
  expect(onChange).toHaveBeenCalledTimes(3);
  token = null;
  synchronize();
  expect(socket.close).toHaveBeenCalledTimes(1);
  stop();
  expect(unwatch).toHaveBeenCalledOnce();
});

it("announces the open drawer again after reconnecting with a new ticket", async () => {
  vi.useFakeTimers();
  try {
    const sockets: Socket[] = [];
    class Socket {
      static OPEN = 1;
      readyState = 1;
      send = vi.fn();
      close = vi.fn();
      onmessage?: (event: { data: string }) => void;
      onclose?: (event: { code: number }) => void;
      constructor(readonly url: URL) {
        sockets.push(this);
      }
    }
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ticket: "fresh-ticket" }) });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("WebSocket", Socket);
    const client = createTradeUpdatesClient(
      "/api",
      { getAccessToken: () => "session" },
      () => () => {},
    );
    client.setEditingTrade?.("TD-00042");
    const stop = client.subscribe({ onChange: vi.fn(), onStatus: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].onmessage?.({
      data: JSON.stringify({ type: "connection.ready", connectionId: "first" }),
    });
    sockets[0].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch).toHaveBeenCalledTimes(2);
    sockets[1].onmessage?.({
      data: JSON.stringify({ type: "connection.ready", connectionId: "second" }),
    });
    expect(sockets[1].send).toHaveBeenCalledWith(
      JSON.stringify({ type: "trade.editing", tradeId: "TD-00042" }),
    );
    stop();
  } finally {
    vi.useRealTimers();
  }
});
