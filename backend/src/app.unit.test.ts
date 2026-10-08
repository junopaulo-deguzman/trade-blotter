import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "./app.ts";
import * as trades from "./trades/trades.service.ts";
import * as auth from "./auth/auth.service.ts";
import * as instruments from "./instruments/instruments.service.ts";
import * as traders from "./traders/traders.service.ts";
import { AuthError } from "./auth/auth.errors.ts";
import { consumeTicket } from "./ws/tickets.ts";
import { TradeError } from "./trades/trades.errors.ts";

// The real app, routes, validation and auth middleware run. Only service/repository I/O is mocked.
vi.mock("./counterparties/counterparties.repository.ts", () => ({
  selectCounterparties: vi.fn().mockResolvedValue([]),
}));
vi.mock("./books/books.repository.ts", () => ({ selectBooks: vi.fn().mockResolvedValue([]) }));
vi.mock("./positions/positions.repository.ts", () => ({
  selectOpeningHoldings: vi.fn().mockResolvedValue([]),
}));
vi.mock("./trades/trades.service.ts", () => ({
  getTrades: vi.fn(),
  getTrade: vi.fn(),
  createTrade: vi.fn(),
  cancelTrade: vi.fn(),
  amendTrade: vi.fn(),
  getTradeOptions: vi.fn(),
}));
vi.mock("./auth/auth.service.ts", () => ({
  login: vi.fn(),
  authenticate: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("./instruments/instruments.service.ts", () => ({ getInstruments: vi.fn() }));
vi.mock("./traders/traders.service.ts", () => ({ getTraders: vi.fn() }));
const token = "t".repeat(43);
const context = {
  user: { id: 8, username: "recorder", name: "Recorder" },
  tokenHash: "token-hash",
};
const input = {
  symbol: "AAPL",
  trader: "ABROWN",
  side: "BUY",
  quantity: 10,
  price: 150.25,
  book: "UK",
  counterparty: "Bank",
  tradeTimestamp: "2026-08-18T09:15:23Z",
};
const trade = {
  ...input,
  side: "BUY" as const,
  status: "ACTIVE" as const,
  tradeId: "TD-00042",
  recordedById: "8",
  tradeTimestamp: "2026-08-18T09:15:23.000Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(auth.authenticate).mockResolvedValue(context);
});

describe("trade HTTP endpoints", () => {
  it("POST /trades validates input and records using the bearer identity", async () => {
    vi.mocked(trades.createTrade).mockResolvedValue(trade);
    const response = await request(app)
      .post("/api/trades")
      .auth(token, { type: "bearer" })
      .send({ ...input, symbol: " aapl ", trader: " abrown ", book: " UK " });
    expect(response.status).toBe(201);
    expect(response.body).toEqual(trade);
    expect(trades.createTrade).toHaveBeenCalledWith(input, 8);
  });
  it.each([{ recordedById: "99" }, { status: "CANCELLED" }, { quantity: 0 }, { price: "150" }])(
    "POST /trades rejects invalid or server-controlled values: %j",
    async (change) => {
      const response = await request(app)
        .post("/api/trades")
        .auth(token, { type: "bearer" })
        .send({ ...input, ...change });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: "Invalid request.",
        code: "VALIDATION_ERROR",
        fieldErrors: expect.any(Object),
      });
      expect(trades.createTrade).not.toHaveBeenCalled();
    },
  );
  it("POST /trades requires a valid bearer session before recording", async () => {
    const missing = await request(app).post("/api/trades").send(input);
    vi.mocked(auth.authenticate).mockRejectedValue(new AuthError({ reason: "invalid_session" }));
    const invalid = await request(app)
      .post("/api/trades")
      .auth(token, { type: "bearer" })
      .send(input);
    for (const response of [missing, invalid]) {
      expect(response.status).toBe(401);
      expect(response.headers["www-authenticate"]).toBe("Bearer");
      expect(response.body).toEqual({ error: "Authentication required.", code: "UNAUTHORIZED" });
    }
    expect(trades.createTrade).not.toHaveBeenCalled();
  });
  it("POST /trades translates an unknown instrument into a field error", async () => {
    vi.mocked(trades.createTrade).mockRejectedValue(
      new TradeError({ reason: "unknown_instrument", symbol: "AAPL" }),
    );
    const response = await request(app)
      .post("/api/trades")
      .auth(token, { type: "bearer" })
      .send(input);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid request.",
      code: "VALIDATION_ERROR",
      fieldErrors: { symbol: ["Unknown symbol."] },
    });
  });
  it("POST /trades translates an unknown counterparty into a field error", async () => {
    vi.mocked(trades.createTrade).mockRejectedValue(
      new TradeError({ reason: "unknown_counterparty", counterparty: input.counterparty }),
    );
    const response = await request(app)
      .post("/api/trades")
      .auth(token, { type: "bearer" })
      .send(input);
    expect(response.status).toBe(400);
    expect(response.body.fieldErrors).toEqual({ counterparty: ["Unknown counterparty."] });
  });
  it("POST /trades translates an unknown trader into a field error", async () => {
    vi.mocked(trades.createTrade).mockRejectedValue(
      new TradeError({ reason: "unknown_trader", traderCode: "ABROWN" }),
    );
    const response = await request(app)
      .post("/api/trades")
      .auth(token, { type: "bearer" })
      .send(input);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid request.",
      code: "VALIDATION_ERROR",
      fieldErrors: { trader: ["Unknown trader code."] },
    });
  });
  it("POST /trades requires authentication again if its recorder disappears during recording", async () => {
    vi.mocked(trades.createTrade).mockRejectedValue(
      new TradeError({ reason: "recorder_not_found", recorderId: 8 }),
    );
    const response = await request(app)
      .post("/api/trades")
      .auth(token, { type: "bearer" })
      .send(input);
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(response.body).toEqual({ error: "Authentication required.", code: "UNAUTHORIZED" });
  });
  it("GET /trades is public and applies pagination defaults", async () => {
    vi.mocked(trades.getTrades).mockResolvedValue({
      trades: [trade],
      pagination: { limit: 100, offset: 0, total: 1 },
    });
    const response = await request(app).get("/api/trades");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      trades: [trade],
      pagination: { limit: 100, offset: 0, total: 1 },
    });
    expect(trades.getTrades).toHaveBeenCalledWith({ limit: 100, offset: 0 });
    expect(auth.authenticate).not.toHaveBeenCalled();
  });
  it("GET /trades forwards validated pagination and retains an out-of-range total", async () => {
    vi.mocked(trades.getTrades).mockResolvedValue({
      trades: [],
      pagination: { limit: 2, offset: 10, total: 3 },
    });
    const response = await request(app).get("/api/trades?limit=2&offset=10");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ trades: [], pagination: { limit: 2, offset: 10, total: 3 } });
    expect(trades.getTrades).toHaveBeenCalledWith({ limit: 2, offset: 10 });
  });
  it.each(["limit=0", "limit=1&limit=2", "offset=-1"])(
    "GET /trades rejects %s before querying",
    async (query) => {
      const response = await request(app).get(`/api/trades?${query}`);
      expect(response.status).toBe(400);
      expect(trades.getTrades).not.toHaveBeenCalled();
    },
  );
  it.each(["42", "TD-00042"])("GET /trades/%s resolves the same trade", async (id) => {
    vi.mocked(trades.getTrade).mockResolvedValue(trade);
    const response = await request(app).get(`/api/trades/${id}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(trade);
    expect(trades.getTrade).toHaveBeenCalledWith(42);
  });
  it("GET /trades/:id distinguishes invalid identifiers and absent trades", async () => {
    const invalid = await request(app).get("/api/trades/nope");
    expect(invalid.status).toBe(400);
    expect(trades.getTrade).not.toHaveBeenCalled();
    vi.mocked(trades.getTrade).mockRejectedValue(
      new TradeError({ reason: "trade_not_found", tradeId: 42 }),
    );
    const missing = await request(app).get("/api/trades/42");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "Trade not found.", code: "TRADE_NOT_FOUND" });
  });
  it("GET /trades/options reaches the options route instead of ID parsing", async () => {
    const options = { symbols: ["AAPL"], traders: ["ABROWN"], books: [], counterparties: [] };
    vi.mocked(trades.getTradeOptions).mockResolvedValue(options);
    const response = await request(app).get("/api/trades/options");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(options);
    expect(trades.getTrade).not.toHaveBeenCalled();
  });
  it("POST /trades handles malformed JSON on the actual create endpoint", async () => {
    const response = await request(app)
      .post("/api/trades")
      .auth(token, { type: "bearer" })
      .set("Content-Type", "application/json")
      .send("{broken");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(trades.createTrade).not.toHaveBeenCalled();
  });
  it("GET /trades contains unexpected database failures without disclosing details", async () => {
    vi.mocked(trades.getTrades).mockRejectedValue(new Error("secret database detail"));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await request(app).get("/api/trades");
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal server error.", code: "INTERNAL_ERROR" });
      expect(logger).toHaveBeenCalledWith("Unhandled request failure");
    } finally {
      logger.mockRestore();
    }
  });
});

describe("reference and account HTTP endpoints", () => {
  it("GET /instruments and GET /traders expose public reference data", async () => {
    const instrumentList = [{ symbol: "AAPL", name: "Apple" }];
    const traderList = [{ traderCode: "ABROWN", traderName: "Alex" }];
    vi.mocked(instruments.getInstruments).mockResolvedValue(instrumentList);
    vi.mocked(traders.getTraders).mockResolvedValue(traderList);
    for (const prefix of ["/api"]) {
      const instrumentsResponse = await request(app).get(`${prefix}/instruments`);
      const tradersResponse = await request(app).get(`${prefix}/traders`);
      expect(instrumentsResponse.status).toBe(200);
      expect(instrumentsResponse.body).toEqual(instrumentList);
      expect(tradersResponse.status).toBe(200);
      expect(tradersResponse.body).toEqual(traderList);
    }
    expect(auth.authenticate).not.toHaveBeenCalled();
  });
  it("POST /auth/login validates credentials and returns the service token response", async () => {
    const loginResponse = {
      accessToken: token,
      tokenType: "Bearer" as const,
      expiresAt: "2026-08-18T17:15:23.000Z",
      user: context.user,
    };
    vi.mocked(auth.login).mockResolvedValue(loginResponse);
    const response = await request(app)
      .post("/api/auth/login")
      .send({ username: " recorder ", password: "password" });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual(loginResponse);
    expect(auth.login).toHaveBeenCalledWith({ username: "recorder", password: "password" });
  });
  it("POST /auth/login rejects a malformed credential body before authentication", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ username: "recorder", password: 1 });
    expect(response.status).toBe(400);
    expect(auth.login).not.toHaveBeenCalled();
  });
  it("POST /auth/login preserves a workflow-specific credentials error", async () => {
    vi.mocked(auth.login).mockRejectedValue(new AuthError({ reason: "invalid_credentials" }));
    const response = await request(app)
      .post("/api/auth/login")
      .send({ username: "recorder", password: "wrong" });
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(response.body).toEqual({
      error: "Invalid username or password.",
      code: "INVALID_CREDENTIALS",
    });
  });
  it.each(["Basic abc", "Bearer short", "Bearer", `Bearer ${token} extra`])(
    "GET /auth/me rejects malformed authorization: %s",
    async (header) => {
      const response = await request(app).get("/api/auth/me").set("Authorization", header);
      expect(response.status).toBe(401);
      expect(response.headers["www-authenticate"]).toBe("Bearer");
      expect(response.body).toEqual({ error: "Authentication required.", code: "UNAUTHORIZED" });
      expect(auth.authenticate).not.toHaveBeenCalled();
    },
  );
  it.each(["/api/auth/me"])("%s rejects a revoked session", async (path) => {
    vi.mocked(auth.authenticate).mockRejectedValue(new AuthError({ reason: "invalid_session" }));
    const response = await request(app).get(path).auth(token, { type: "bearer" });
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(response.body).toEqual({ error: "Authentication required.", code: "UNAUTHORIZED" });
  });
  it("GET /auth/me exposes only the authenticated account and POST /auth/logout revokes its session", async () => {
    const me = await request(app).get("/api/auth/me").auth(token, { type: "bearer" });
    expect(me.status).toBe(200);
    expect(me.body).toEqual(context.user);
    const logout = await request(app).post("/api/auth/logout").auth(token, { type: "bearer" });
    expect(logout.status).toBe(204);
    expect(logout.text).toBe("");
    expect(auth.logout).toHaveBeenCalledWith(context.tokenHash);
  });
  it.each([
    ["get", "/api/auth/me"],
    ["post", "/api/auth/logout"],
  ] as const)("%s %s requires authentication", async (method, path) => {
    const response = await request(app)[method](path);
    expect(response.status).toBe(401);
    expect(auth.logout).not.toHaveBeenCalled();
  });
  it("returns JSON 404s for unregistered endpoints", async () => {
    const response = await request(app).get("/api/missing");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Route not found.", code: "ROUTE_NOT_FOUND" });
  });
});

describe("unexpected endpoint failures", () => {
  it.each([
    [
      "post",
      "/api/trades",
      trades.createTrade,
      input,
      new TradeError({ reason: "trade_not_found", tradeId: 42 }),
    ],
    [
      "get",
      "/api/trades/42",
      trades.getTrade,
      undefined,
      new TradeError({ reason: "unknown_instrument", symbol: "AAPL" }),
    ],
    [
      "get",
      "/api/auth/me",
      auth.authenticate,
      undefined,
      new AuthError({ reason: "invalid_credentials" }),
    ],
    [
      "post",
      "/api/auth/logout",
      auth.logout,
      undefined,
      new AuthError({ reason: "user_not_found", username: "recorder" }),
    ],
    [
      "post",
      "/api/auth/login",
      auth.login,
      { username: "recorder", password: "password" },
      new AuthError({ reason: "user_not_found", username: "recorder" }),
    ],
  ] as const)(
    "%s %s rethrows feature failures it does not handle",
    async (method, path, service, body, error) => {
      vi.mocked(service).mockRejectedValue(error);
      const logger = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const call = request(app)[method](path).auth(token, { type: "bearer" });
        const response = await (body ? call.send(body) : call);
        expect(response.status).toBe(500);
        expect(response.headers["www-authenticate"]).toBeUndefined();
        expect(response.body).toEqual({ error: "Internal server error.", code: "INTERNAL_ERROR" });
        expect(logger).toHaveBeenCalledWith("Unhandled request failure");
      } finally {
        logger.mockRestore();
      }
    },
  );
  it.each([
    ["post", "/api/trades", trades.createTrade, input],
    ["get", "/api/trades/42", trades.getTrade, undefined],
    ["get", "/api/auth/me", auth.authenticate, undefined],
    ["post", "/api/auth/logout", auth.logout, undefined],
    ["post", "/api/auth/login", auth.login, { username: "recorder", password: "password" }],
  ] as const)("%s %s forwards unexpected service failures", async (method, path, service, body) => {
    vi.mocked(service).mockRejectedValue(new Error("private database failure"));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const call = request(app)[method](path).auth(token, { type: "bearer" });
      const response = await (body ? call.send(body) : call);
      expect(response.status).toBe(500);
      expect(response.headers["www-authenticate"]).toBeUndefined();
      expect(response.body).toEqual({ error: "Internal server error.", code: "INTERNAL_ERROR" });
      expect(logger).toHaveBeenCalledWith("Unhandled request failure");
    } finally {
      logger.mockRestore();
    }
  });
});

describe("WebSocket ticket endpoint", () => {
  it("requires authentication and binds a single-use ticket to the session", async () => {
    const missing = await request(app).post("/api/ws/ticket");
    expect(missing.status).toBe(401);
    const response = await request(app).post("/api/ws/ticket").auth(token, { type: "bearer" });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(response.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(consumeTicket(response.body.ticket)).toBe(context.tokenHash);
    expect(consumeTicket(response.body.ticket)).toBeUndefined();
  });
  it("does not issue tickets for revoked sessions", async () => {
    vi.mocked(auth.authenticate).mockRejectedValue(new AuthError({ reason: "invalid_session" }));
    const response = await request(app).post("/api/ws/ticket").auth(token, { type: "bearer" });
    expect(response.status).toBe(401);
    expect(response.body.ticket).toBeUndefined();
  });
});

describe("API prefix", () => {
  it.each([
    "/trades",
    "/trades/42",
    "/trades/options",
    "/instruments",
    "/traders",
    "/health",
    "/auth/me",
  ])("rejects the unprefixed GET %s", async (path) => {
    const response = await request(app).get(path);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("ROUTE_NOT_FOUND");
  });
  it.each(["/trades", "/auth/login", "/auth/logout", "/ws/ticket"])(
    "rejects the unprefixed POST %s",
    async (path) => {
      const response = await request(app).post(path).auth(token, { type: "bearer" }).send(input);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("ROUTE_NOT_FOUND");
    },
  );
});

describe("trade change endpoints", () => {
  it("cancels and amends using the authenticated recorder", async () => {
    vi.mocked(trades.cancelTrade).mockResolvedValue({ ...trade, status: "CANCELLED" });
    vi.mocked(trades.amendTrade).mockResolvedValue({ ...trade, quantity: 12 });
    const cancelled = await request(app)
      .patch("/api/trades/cancel/TD-00042")
      .auth(token, { type: "bearer" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    expect(trades.cancelTrade).toHaveBeenCalledWith(42, 8);
    const amended = await request(app)
      .patch("/api/trades/TD-00042")
      .auth(token, { type: "bearer" })
      .send({ ...input, quantity: 12 });
    expect(amended.status).toBe(200);
    expect(amended.body.quantity).toBe(12);
    expect(trades.amendTrade).toHaveBeenCalledWith(42, { ...input, quantity: 12 }, 8);
  });
  it.each(["/api/trades/cancel/TD-00042", "/api/trades/TD-00042"])(
    "requires authentication for %s",
    async (url) => {
      const result = await request(app).patch(url).send(input);
      expect(result.status).toBe(401);
      expect(trades.cancelTrade).not.toHaveBeenCalled();
      expect(trades.amendTrade).not.toHaveBeenCalled();
    },
  );
  it.each([{ quantity: 0 }, { recordedById: "99" }, { status: "CANCELLED" }])(
    "validates edits: %j",
    async (change) => {
      const result = await request(app)
        .patch("/api/trades/TD-00042")
        .auth(token, { type: "bearer" })
        .send({ ...input, ...change });
      expect(result.status).toBe(400);
      expect(trades.amendTrade).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["trade_not_found", 404, "TRADE_NOT_FOUND"],
    ["trade_forbidden", 403, "TRADE_FORBIDDEN"],
    ["trade_not_active", 409, "TRADE_NOT_ACTIVE"],
  ] as const)("maps %s for both changes", async (reason, status, code) => {
    const error = new TradeError({ reason, tradeId: 42 });
    vi.mocked(trades.cancelTrade).mockRejectedValue(error);
    vi.mocked(trades.amendTrade).mockRejectedValue(error);
    for (const url of ["/api/trades/cancel/TD-00042", "/api/trades/TD-00042"]) {
      const result = await request(app).patch(url).auth(token, { type: "bearer" }).send(input);
      expect(result.status).toBe(status);
      expect(result.body.code).toBe(code);
    }
  });
});
