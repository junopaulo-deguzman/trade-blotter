import { createHttpClient, type HttpOptions } from "./http-client";
import type { TradeUpdatesClient } from "@/store/services";
import type { WebSocketTicket } from "@/types/ws";

export function createTradeUpdatesClient(
  baseUrl: string,
  options: HttpOptions,
  watchSession: (listener: () => void) => () => void,
): TradeUpdatesClient {
  const request = createHttpClient(baseUrl, options);
  let editingTradeId: string | null = null;
  let announce: (() => void) | undefined;
  return {
    setEditingTrade(tradeId) {
      editingTradeId = tradeId;
      announce?.();
    },
    subscribe({ onChange, onStatus, onPresence, onReady }) {
      let stopped = false;
      let token: string | null | undefined;
      let socket: WebSocket | undefined;
      let controller: AbortController | undefined;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let generation = 0;
      let ready = false;
      const sendPresence = () => {
        if (ready && socket?.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: "trade.editing", tradeId: editingTradeId }));
      };
      announce = sendPresence;
      async function connect() {
        const current = ++generation;
        if (!token || stopped) return;
        onStatus("connecting");
        controller = new AbortController();
        try {
          const { ticket } = await request<WebSocketTicket>("/ws/ticket", {
            method: "POST",
            signal: controller.signal,
          });
          if (stopped || current !== generation) return;
          const url = new URL(`${baseUrl.replace(/\/$/, "")}/ws`, window.location.href);
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
          url.searchParams.set("ticket", ticket);
          socket = new WebSocket(url);
          socket.onmessage = ({ data }) => {
            if (stopped || current !== generation) return;
            try {
              const event = JSON.parse(data);
              if (event.type === "connection.ready") {
                ready = true;
                onReady?.(event.connectionId);
                onStatus("connected");
                sendPresence();
              } else if (event.type === "editing.snapshot" && Array.isArray(event.trades)) {
                onPresence?.(event);
              } else if (
                event.type === "trade.editing" &&
                typeof event.tradeId === "string" &&
                Array.isArray(event.editors)
              ) {
                onPresence?.(event);
              } else if (
                event.type === "trade.changed" &&
                typeof event.tradeId === "string" &&
                ["created", "cancelled", "amended"].includes(event.action)
              )
                onChange(event);
            } catch {
              /* Ignore malformed frames. */
            }
          };
          socket.onclose = ({ code }) => {
            if (stopped || current !== generation) return;
            ready = false;
            onStatus("disconnected");
            if (code === 4401 && token) options.onUnauthorized?.(token);
            else retry = setTimeout(connect, 3000);
          };
        } catch {
          if (stopped || current !== generation) return;
          onStatus("disconnected");
          retry = setTimeout(connect, 3000);
        }
      }
      function synchronize() {
        const next = options.getAccessToken?.() ?? null;
        if (next === token) return;
        ready = false;
        token = next;
        generation++;
        clearTimeout(retry);
        controller?.abort();
        socket?.close();
        if (token) void connect();
        else onStatus("disconnected");
      }
      const unwatch = watchSession(synchronize);
      synchronize();
      return () => {
        stopped = true;
        if (announce === sendPresence) announce = undefined;
        generation++;
        unwatch();
        clearTimeout(retry);
        controller?.abort();
        socket?.close();
      };
    },
  };
}
