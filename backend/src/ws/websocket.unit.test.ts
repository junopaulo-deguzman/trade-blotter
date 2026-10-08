import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attachTradeWebSocket } from "./websocket.ts";
import { issueTicket, consumeTicket } from "./tickets.ts";
import { publishTradeChanged } from "./events.ts";

vi.mock("../auth/auth.repository.ts", () => ({ selectSession: vi.fn() }));

let server: Server;
let stop: () => void;
let base: string;
const sockets: WebSocket[] = [];
const origin = "http://localhost:5173";
const checkSession = vi.fn(async () => true);
beforeEach(async () => {
  checkSession.mockReset().mockResolvedValue(true);
  server = createServer();
  stop = attachTradeWebSocket(server, {
    origins: [origin],
    checkSession,
    getUser: async () => ({ id: 8, username: "recorder", name: "Recorder" }),
    heartbeatMs: 50,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  base = `ws://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function connect(ticket: string, requestOrigin = origin, path = "/api/ws") {
  const ws = new WebSocket(`${base}${path}?ticket=${ticket}`, { origin: requestOrigin });
  sockets.push(ws);
  return ws;
}
async function ready() {
  const ws = connect(issueTicket("session-hash").ticket);
  const [data] = await once(ws, "message");
  expect(JSON.parse(String(data))).toMatchObject({
    type: "connection.ready",
    connectionId: expect.any(String),
  });
  return ws;
}
async function rejected(ticket: string, requestOrigin = origin, path = "/api/ws") {
  const ws = connect(ticket, requestOrigin, path);
  return new Promise<number>((resolve, reject) => {
    ws.on("unexpected-response", (_req, res) => {
      res.resume();
      ws.terminate();
      resolve(res.statusCode!);
    });
    ws.on("error", () => {});
    setTimeout(() => reject(new Error("Upgrade was not rejected")), 1000).unref();
  });
}
it("requires valid tickets, exact origin, supported path, and an active session", async () => {
  expect(await rejected("invalid")).toBe(401);
  expect(await rejected(issueTicket("hash").ticket, "https://other.example")).toBe(403);
  expect(await rejected(issueTicket("hash").ticket, origin, "/other")).toBe(404);
  checkSession.mockResolvedValue(false);
  expect(await rejected(issueTicket("hash").ticket)).toBe(401);
});
it("tickets are single-use and expire", () => {
  const { ticket } = issueTicket("hash");
  expect(consumeTicket(ticket)).toBe("hash");
  expect(consumeTicket(ticket)).toBeUndefined();
  const expired = issueTicket("hash");
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
  expect(consumeTicket(expired.ticket)).toBeUndefined();
  now.mockRestore();
});
it("broadcasts changes to both authenticated clients", async () => {
  const a = await ready();
  const b = await ready();
  const messages = Promise.all([once(a, "message"), once(b, "message")]);
  publishTradeChanged({ tradeId: "TD-00042", action: "cancelled" });
  for (const [data] of await messages)
    expect(JSON.parse(String(data))).toEqual({
      type: "trade.changed",
      tradeId: "TD-00042",
      action: "cancelled",
    });
});
it("rechecks revocation before broadcasting and closes with 4401", async () => {
  const ws = await ready();
  const message = vi.fn();
  ws.on("message", message);
  const closed = once(ws, "close");
  checkSession.mockResolvedValue(false);
  publishTradeChanged({ tradeId: "TD-00042", action: "amended" });
  const [code] = await closed;
  expect(code).toBe(4401);
  expect(message).not.toHaveBeenCalled();
});
it("checks idle sessions and rejects client application messages", async () => {
  const ws = await ready();
  const closed = once(ws, "close");
  checkSession.mockResolvedValue(false);
  expect((await closed)[0]).toBe(4401);
  checkSession.mockResolvedValue(true);
  const other = await ready();
  const rejectedMessage = once(other, "close");
  other.send("unexpected");
  expect((await rejectedMessage)[0]).toBe(1008);
});
it("closes connected clients during shutdown", async () => {
  const ws = await ready();
  const closed = once(ws, "close");
  stop();
  expect((await closed)[0]).toBe(1001);
});

it("rejects replayed tickets during HTTP upgrade", async () => {
  const { ticket } = issueTicket("hash");
  const ws = connect(ticket);
  await once(ws, "message");
  expect(await rejected(ticket)).toBe(401);
});
it("fails closed when session storage is unavailable", async () => {
  checkSession.mockRejectedValue(new Error("database unavailable"));
  expect(await rejected(issueTicket("hash").ticket)).toBe(503);
  checkSession.mockResolvedValue(true);
  const ws = await ready();
  const closed = once(ws, "close");
  checkSession.mockRejectedValue(new Error("database unavailable"));
  publishTradeChanged({ tradeId: "TD-00042", action: "created" });
  expect((await closed)[0]).toBe(1011);
});

it("tracks multiple editors, snapshots presence, switches trades and clears on disconnect", async () => {
  const a = await ready();
  const b = await ready();
  const messages: {
    type: string;
    tradeId?: string;
    editors?: { name: string; connectionId: string }[];
  }[] = [];
  b.on("message", (data) => messages.push(JSON.parse(String(data))));
  a.send(JSON.stringify({ type: "trade.editing", tradeId: "TD-00042" }));
  await vi.waitFor(() =>
    expect(messages.at(-1)).toMatchObject({ tradeId: "TD-00042", editors: [{ name: "Recorder" }] }),
  );
  b.send(JSON.stringify({ type: "trade.editing", tradeId: "TD-00042" }));
  await vi.waitFor(() => expect(messages.at(-1)?.editors).toHaveLength(2));
  const c = connect(issueTicket("session-hash").ticket);
  const snapshot = new Promise<unknown>((resolve) =>
    c.on("message", (data) => {
      const event = JSON.parse(String(data));
      if (event.type === "editing.snapshot") resolve(event);
    }),
  );
  expect(await snapshot).toMatchObject({
    type: "editing.snapshot",
    trades: [{ tradeId: "TD-00042", editors: [{ name: "Recorder" }, { name: "Recorder" }] }],
  });
  a.send(JSON.stringify({ type: "trade.editing", tradeId: "TD-00043" }));
  await vi.waitFor(() =>
    expect(
      messages.some((event) => event.tradeId === "TD-00042" && event.editors?.length === 1),
    ).toBe(true),
  );
  await vi.waitFor(() =>
    expect(
      messages.some((event) => event.tradeId === "TD-00043" && event.editors?.length === 1),
    ).toBe(true),
  );
  a.close();
  await vi.waitFor(() =>
    expect(
      messages.some((event) => event.tradeId === "TD-00043" && event.editors?.length === 0),
    ).toBe(true),
  );
  b.send(JSON.stringify({ type: "trade.editing", tradeId: null }));
  await vi.waitFor(() =>
    expect(messages.at(-1)).toMatchObject({ tradeId: "TD-00042", editors: [] }),
  );
});
it("rejects malformed presence and client-supplied identities", async () => {
  const ws = await ready();
  const closed = once(ws, "close");
  ws.send(JSON.stringify({ type: "trade.editing", tradeId: "TD-00042", name: "Fake" }));
  expect((await closed)[0]).toBe(1008);
});
