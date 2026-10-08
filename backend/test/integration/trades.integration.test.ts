import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.ts";
import { db } from "../../db/connection.ts";
import { subscribeTradeChanges } from "../../src/ws/events.ts";
import { hashPassword } from "../../src/auth/password.ts";
let userId: number;
let token: string;
const input = {
  symbol: "AAPL",
  trader: "ABROWN",
  side: "BUY",
  quantity: 100,
  price: 150.25,
  book: "EQUITIES_UK",
  counterparty: "Bank",
  tradeTimestamp: "2026-08-18T09:15:23Z",
};
const create = (body: object = input) =>
  request(app).post("/api/trades").auth(token, { type: "bearer" }).send(body);
beforeAll(async () => {
  await db.query("INSERT INTO counterparties(name) VALUES ('Bank') ON CONFLICT DO NOTHING");
  await db.query(
    "INSERT INTO instruments (symbol, name) VALUES ('MSFT','Microsoft'),('AAPL','Apple')",
  );
  await db.query(
    "INSERT INTO traders (trader_code, name) VALUES ('ZTRADER','Zed'),('ABROWN','Alex Brown')",
  );
  const hash = await hashPassword("integration-password");
  const user = await db.query<{ id: number }>(
    "INSERT INTO users (name,user_name,password_hash,created_at,updated_at) VALUES ('Recorder','recorder',$1,NOW(),NOW()) RETURNING id",
    [hash],
  );
  userId = user.rows[0]!.id;
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "recorder", password: "integration-password" });
  expect(login.status).toBe(200);
  token = login.body.accessToken;
});
beforeEach(async () => {
  await db.query("DELETE FROM trades");
});
describe("trade workflows with PostgreSQL", () => {
  it("creates a complete flat response with the authenticated recorder and submitted time", async () => {
    const response = await create({
      ...input,
      symbol: " aapl ",
      trader: " abrown ",
      book: " EQUITIES_UK ",
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      ...input,
      tradeId: expect.stringMatching(/^TD-\d{5,}$/),
      status: "ACTIVE",
      recordedById: String(userId),
      tradeTimestamp: "2026-08-18T09:15:23.000Z",
    });
    const row = (await db.query("SELECT * FROM trades")).rows[0];
    expect(row.recorded_by_id).toBe(userId);
    expect(row.price).toBe("150.25");
    expect(row.status).toBe("ACTIVE");
    expect(row.counterparty).toBe("Bank");
    expect(row.trade_timestamp.toISOString()).toBe(response.body.tradeTimestamp);
    const get = await request(app).get(`/api/trades/${response.body.tradeId}`);
    const legacy = await request(app).get(`/api/trades/${row.id}`);
    const list = await request(app).get("/api/trades");
    expect(get.body).toEqual(response.body);
    expect(legacy.body).toEqual(response.body);
    expect(list.body.trades).toEqual([response.body]);
  });
  it("paginates ties deterministically, preserves totals, and returns final/out-of-range pages", async () => {
    const ids: string[] = [];
    for (const quantity of [100, 101, 102]) {
      const response = await create({ ...input, quantity });
      expect(response.status).toBe(201);
      ids.push(response.body.tradeId);
    }
    const first = await request(app).get("/api/trades?limit=2&offset=0");
    const last = await request(app).get("/api/trades?limit=2&offset=2");
    const beyond = await request(app).get("/api/trades?limit=2&offset=10");
    expect(first.body.trades.map((trade: { tradeId: string }) => trade.tradeId)).toEqual(
      ids.slice(1).reverse(),
    );
    expect(first.body.pagination).toEqual({ limit: 2, offset: 0, total: 3 });
    expect(last.body.trades.map((trade: { tradeId: string }) => trade.tradeId)).toEqual([ids[0]]);
    expect(last.body.pagination).toEqual({ limit: 2, offset: 2, total: 3 });
    expect(beyond.body).toEqual({ trades: [], pagination: { limit: 2, offset: 10, total: 3 } });
  });
  it("sorts by execution time before ID", async () => {
    const newer = await create({ ...input, tradeTimestamp: "2026-08-19T00:00:00Z" });
    const older = await create();
    const response = await request(app).get("/api/trades");
    expect(response.body.trades.map((trade: { tradeId: string }) => trade.tradeId)).toEqual([
      newer.body.tradeId,
      older.body.tradeId,
    ]);
  });
  it("returns defaults and an empty page in an empty database", async () => {
    const response = await request(app).get("/api/trades");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ trades: [], pagination: { limit: 100, offset: 0, total: 0 } });
  });
  it.each([
    "limit=0",
    "limit=101",
    "limit=2.5",
    "limit=1&limit=2",
    "offset=-1",
    "offset=1.5",
    "offset=foo",
    "offset=9007199254740992",
  ])("rejects pagination %s", async (query) => {
    const response = await request(app).get(`/api/trades?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });
  it("distinguishes malformed IDs, missing trades, and unknown routes", async () => {
    expect((await request(app).get("/api/trades/nope")).status).toBe(400);
    const missing = await request(app).get("/api/trades/TD-2147483647");
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("TRADE_NOT_FOUND");
    const unknown = await request(app).get("/missing");
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe("ROUTE_NOT_FOUND");
  });
  it("serves sorted public references and options without requiring existing trades", async () => {
    const instruments = await request(app).get("/api/instruments");
    const traders = await request(app).get("/api/traders");
    expect(instruments.body).toEqual([
      { symbol: "AAPL", name: "Apple" },
      { symbol: "MSFT", name: "Microsoft" },
    ]);
    expect(traders.body).toEqual([
      { traderCode: "ABROWN", traderName: "Alex Brown" },
      { traderCode: "ZTRADER", traderName: "Zed" },
    ]);
    const counterparties = await request(app).get("/api/counterparties");
    expect(counterparties.status).toBe(200);
    expect(counterparties.body.map((item: { name: string }) => item.name)).toEqual([
      "Bank",
      "Barclays",
      "Goldman Sachs",
      "JP Morgan",
      "Morgan Stanley",
      "UBS",
    ]);
    const books = await request(app).get("/api/books");
    expect(books.body.map((book: { code: string }) => book.code)).toEqual([
      "EQUITIES_UK",
      "EQUITIES_US",
      "TECH_GROWTH",
    ]);
    await db.query(`INSERT INTO opening_holdings (book_code, symbol_id, quantity)
      SELECT 'EQUITIES_UK', id, 500 FROM instruments WHERE symbol = 'AAPL'`);
    const holdings = await request(app).get("/api/positions/opening");
    expect(holdings.status).toBe(200);
    expect(holdings.body).toEqual([{ book: "EQUITIES_UK", symbol: "AAPL", quantity: 500 }]);
    const options = await request(app).get("/api/trades/options");
    expect(options.body).toEqual({
      symbols: ["AAPL", "MSFT"],
      traders: ["ABROWN", "ZTRADER"],
      books: ["EQUITIES_UK", "EQUITIES_US", "TECH_GROWTH"],
      counterparties: ["Bank", "Barclays", "Goldman Sachs", "JP Morgan", "Morgan Stanley", "UBS"],
    });
    await create();
    await create();
    expect((await request(app).get("/api/trades/options")).body).toMatchObject({
      books: ["EQUITIES_UK", "EQUITIES_US", "TECH_GROWTH"],
      counterparties: ["Bank", "Barclays", "Goldman Sachs", "JP Morgan", "Morgan Stanley", "UBS"],
    });
  });
  it.each([
    { quantity: 0 },
    { quantity: 1.5 },
    { quantity: 2147483648 },
    { quantity: "2" },
    { price: -1 },
    { price: "150.25" },
    { side: "HOLD" },
    { book: " " },
    { book: "UNKNOWN" },
    { counterparty: "UNKNOWN" },
    { symbol: "UNKNOWN" },
    { trader: "UNKNOWN" },
    { tradeTimestamp: "2026-02-30T00:00:00Z" },
    { tradeTimestamp: "2026-08-18T09:15:23+01:00" },
    { recordedById: "999" },
    { status: "CANCELLED" },
    { symbolId: 1 },
    { traderId: 1 },
  ])("rejects invalid creation without inserting: %j", async (change) => {
    const response = await create({ ...input, ...change });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: "Invalid request.",
      code: "VALIDATION_ERROR",
      fieldErrors: expect.any(Object),
    });
    expect((await db.query("SELECT COUNT(*) FROM trades")).rows[0].count).toBe("0");
  });
  it("rejects missing fields, nonobject bodies, and malformed JSON without writes", async () => {
    for (const body of [{}, []]) expect((await create(body)).status).toBe(400);
    const malformed = await request(app)
      .post("/api/trades")
      .auth(token, { type: "bearer" })
      .set("Content-Type", "application/json")
      .send("{broken");
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe("VALIDATION_ERROR");
    expect((await db.query("SELECT COUNT(*) FROM trades")).rows[0].count).toBe("0");
  });
  it("requires authentication before attempting a trade write", async () => {
    for (const authorization of [
      undefined,
      "Basic abc",
      "Bearer invalid",
      `Bearer ${"x".repeat(43)}`,
    ]) {
      const req = request(app).post("/api/trades").send(input);
      if (authorization) req.set("Authorization", authorization);
      const response = await req;
      expect(response.status).toBe(401);
      expect(response.body.code).toBe("UNAUTHORIZED");
    }
    expect((await db.query("SELECT COUNT(*) FROM trades")).rows[0].count).toBe("0");
  });
});

describe("changing persisted trades", () => {
  it("amends and cancels a recorded trade and publishes committed changes", async () => {
    const created = await create();
    const id = created.body.tradeId;
    const events: unknown[] = [];
    const unsubscribe = subscribeTradeChanges((event) => events.push(event));
    try {
      const amended = await request(app)
        .patch(`/api/trades/${id}`)
        .auth(token, { type: "bearer" })
        .send({ ...input, symbol: "MSFT", side: "SELL", quantity: 250, price: 200 });
      expect(amended.status).toBe(200);
      expect(amended.body).toMatchObject({
        tradeId: id,
        recordedById: String(userId),
        status: "ACTIVE",
        symbol: "MSFT",
        side: "SELL",
        quantity: 250,
        price: 200,
      });
      expect((await request(app).get(`/api/trades/${id}`)).body).toEqual(amended.body);
      const cancelled = await request(app)
        .patch(`/api/trades/cancel/${id}`)
        .auth(token, { type: "bearer" });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toEqual({ ...amended.body, status: "CANCELLED" });
      expect(events).toEqual([
        { type: "trade.changed", tradeId: id, action: "amended" },
        { type: "trade.changed", tradeId: id, action: "cancelled" },
      ]);
      for (const path of [`/api/trades/${id}`, `/api/trades/cancel/${id}`]) {
        const result = await request(app).patch(path).auth(token, { type: "bearer" }).send(input);
        expect(result.status).toBe(409);
        expect(result.body.code).toBe("TRADE_NOT_ACTIVE");
      }
      expect(events).toHaveLength(2);
    } finally {
      unsubscribe();
    }
  });
  it("allows other recorders to amend/cancel while preserving the creator and rejects missing trades", async () => {
    const created = await create();
    const hash = await hashPassword("integration-password");
    await db.query(
      "INSERT INTO users (name,user_name,password_hash,created_at,updated_at) VALUES ('Other','other-recorder',$1,NOW(),NOW())",
      [hash],
    );
    const other = await request(app)
      .post("/api/auth/login")
      .send({ username: "other-recorder", password: "integration-password" });
    expect(other.status).toBe(200);
    for (const path of [
      `/api/trades/${created.body.tradeId}`,
      `/api/trades/cancel/${created.body.tradeId}`,
    ]) {
      const result = await request(app)
        .patch(path)
        .auth(other.body.accessToken, { type: "bearer" })
        .send(input);
      expect(result.status).toBe(200);
      expect(result.body.recordedById).toBe(created.body.recordedById);
    }
    expect((await request(app).get(`/api/trades/${created.body.tradeId}`)).body).toEqual({
      ...created.body,
      status: "CANCELLED",
    });
    for (const path of ["/api/trades/2147483647", "/api/trades/cancel/2147483647"]) {
      const result = await request(app).patch(path).auth(token, { type: "bearer" }).send(input);
      expect(result.status).toBe(404);
      expect(result.body.code).toBe("TRADE_NOT_FOUND");
    }
  });
});

it("uses last save wins for amendments and never revives a concurrently cancelled trade", async () => {
  const created = await create();
  const id = created.body.tradeId;
  for (const quantity of [25, 50]) {
    const result = await request(app)
      .patch(`/api/trades/${id}`)
      .auth(token, { type: "bearer" })
      .send({ ...input, quantity });
    expect(result.status).toBe(200);
    expect(result.body.recordedById).toBe(created.body.recordedById);
  }
  expect((await request(app).get(`/api/trades/${id}`)).body.quantity).toBe(50);
  const [amendment, cancellation] = await Promise.all([
    request(app)
      .patch(`/api/trades/${id}`)
      .auth(token, { type: "bearer" })
      .send({ ...input, quantity: 75 }),
    request(app).patch(`/api/trades/cancel/${id}`).auth(token, { type: "bearer" }),
  ]);
  expect([200, 409]).toContain(amendment.status);
  expect(cancellation.status).toBe(200);
  expect((await request(app).get(`/api/trades/${id}`)).body.status).toBe("CANCELLED");
});
