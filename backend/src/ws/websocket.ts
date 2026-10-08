import { randomUUID } from "node:crypto";
import { tradeIdSchema } from "../trades/trades.types.ts";
import type { UserResponse } from "../auth/auth.types.ts";
import type { Editor } from "./events.ts";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { selectSession } from "../auth/auth.repository.ts";
import { consumeTicket } from "./tickets.ts";
import { subscribeTradeChanges, type ServerEvent } from "./events.ts";

interface ClientState {
  tokenHash: string;
  alive: boolean;
  editor: Editor;
  tradeId: string | null;
  messages: Promise<void>;
}
interface Options {
  origins: string[];
  heartbeatMs?: number;
  getUser?: (tokenHash: string) => Promise<UserResponse | null>;
  checkSession?: (tokenHash: string) => Promise<boolean>;
}

export function websocketOrigins(): string[] {
  const configured = process.env.WS_ALLOWED_ORIGINS?.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (configured?.length) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("WS_ALLOWED_ORIGINS is required");
  return [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
  ];
}

export function attachTradeWebSocket(server: Server, options: Options): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const clients = new Map<WebSocket, ClientState>();
  let stopped = false;
  const checkSession =
    options.checkSession ??
    (async (hash) => {
      const session = await selectSession(hash);
      return !!session && session.expires_at.getTime() > Date.now();
    });
  const getUser =
    options.getUser ??
    (async (hash: string) => {
      const session = await selectSession(hash);
      return session
        ? { id: session.user_id, name: session.name, username: session.user_name }
        : null;
    });
  const editors = (tradeId: string): Editor[] =>
    [...clients]
      .filter(([ws, state]) => ws.readyState === WebSocket.OPEN && state.tradeId === tradeId)
      .map(([, state]) => state.editor);
  function broadcastPresence(tradeId: string) {
    if (stopped) return;
    for (const [ws, state] of clients)
      void valid(ws, state).then((ok) => {
        if (ok) send(ws, { type: "trade.editing", tradeId, editors: editors(tradeId) });
      });
  }
  function clearPresence(state: ClientState) {
    const previous = state.tradeId;
    state.tradeId = null;
    if (previous) broadcastPresence(previous);
  }
  function send(ws: WebSocket, event: ServerEvent) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 64 * 1024) {
      ws.terminate();
      return;
    }
    ws.send(JSON.stringify(event));
  }
  async function valid(ws: WebSocket, state: ClientState): Promise<boolean> {
    try {
      if (await checkSession(state.tokenHash)) return ws.readyState === WebSocket.OPEN;
      clearPresence(state);
      ws.close(4401, "Session expired or revoked");
    } catch {
      clearPresence(state);
      ws.close(1011, "Session check failed");
    }
    return false;
  }

  // Keep upgrade handling separate from Express; only ticketed, allowed-origin requests upgrade.
  const upgrade = async (
    req: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => {
    const onError = () => {
      socket.destroy();
    };
    socket.on("error", onError);
    const reject = (status: number, reason: string) => {
      socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/api/ws" || stopped) return reject(404, "Not Found");
      if (!req.headers.origin || !options.origins.includes(req.headers.origin))
        return reject(403, "Forbidden");
      const hash = consumeTicket(url.searchParams.get("ticket") ?? "");
      if (!hash || !(await checkSession(hash))) return reject(401, "Unauthorized");
      const user = await getUser(hash);
      if (!user) return reject(401, "Unauthorized");
      if (stopped || socket.destroyed) return socket.destroy();
      socket.removeListener("error", onError);
      wss.handleUpgrade(req, socket, head, (ws) => {
        const state: ClientState = {
          tokenHash: hash,
          alive: true,
          editor: { connectionId: randomUUID(), userId: user.id, name: user.name },
          tradeId: null,
          messages: Promise.resolve(),
        };
        clients.set(ws, state);
        ws.on("error", () => ws.terminate());
        ws.on("pong", () => {
          state.alive = true;
        });
        ws.on("message", (data, binary) => {
          let tradeId: string | null;
          try {
            const message = JSON.parse(data.toString());
            if (
              binary ||
              message.type !== "trade.editing" ||
              Object.keys(message).some((key) => !["type", "tradeId"].includes(key))
            )
              throw new Error();
            if (message.tradeId === null) tradeId = null;
            else {
              const id = tradeIdSchema.parse(message.tradeId);
              tradeId = `TD-${String(id).padStart(5, "0")}`;
            }
          } catch {
            ws.close(1008, "Invalid editing presence message");
            return;
          }
          state.messages = state.messages
            .then(async () => {
              if (!(await valid(ws, state))) return;
              if (state.tradeId === tradeId) return;
              clearPresence(state);
              state.tradeId = tradeId;
              if (tradeId) broadcastPresence(tradeId);
            })
            .catch(() => {
              clearPresence(state);
              ws.close(1011, "Presence failed");
            });
        });
        ws.on("close", () => {
          clients.delete(ws);
          clearPresence(state);
        });
        send(ws, { type: "connection.ready", connectionId: state.editor.connectionId });
        const tradeIds = [
          ...new Set(
            [...clients.values()]
              .map((client) => client.tradeId)
              .filter((id): id is string => id !== null),
          ),
        ];
        send(ws, {
          type: "editing.snapshot",
          trades: tradeIds.map((tradeId) => ({ tradeId, editors: editors(tradeId) })),
        });
      });
    } catch {
      reject(503, "Service Unavailable");
    }
  };

  server.on("upgrade", upgrade);
  const unsubscribe = subscribeTradeChanges((event) => {
    for (const [ws, state] of clients)
      void valid(ws, state).then((ok) => {
        if (ok) send(ws, event);
      });
  });

  let checking = false;
  // Periodically check the health of each WebSocket connection.
  const heartbeat = setInterval(() => {
    if (checking) return;
    checking = true;
    void Promise.all(
      [...clients].map(async ([ws, state]) => {
        if (!state.alive) {
          ws.terminate();
          return;
        }
        if (!(await valid(ws, state))) return;
        state.alive = false;
        ws.ping();
      }),
    ).finally(() => {
      checking = false;
    });
  }, options.heartbeatMs ?? 30_000);
  heartbeat.unref();

  // Return a function to gracefully shut down the WebSocket server and clean up resources.
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeat);
    unsubscribe();
    server.off("upgrade", upgrade);
    for (const ws of clients.keys()) ws.close(1001, "Server shutting down");
    const deadline = setTimeout(() => {
      for (const ws of clients.keys()) ws.terminate();
    }, 1000);
    deadline.unref();
    wss.close();
  };
}
