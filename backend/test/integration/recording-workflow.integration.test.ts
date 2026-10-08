import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../../src/app.ts";
import { db } from "../../db/connection.ts";
import { hashPassword } from "../../src/auth/password.ts";
import { hashToken } from "../../src/auth/auth.service.ts";

const password = "workflow-password";
const credentials = { username: "recorder-one", password };
const input = {
  symbol: "AAPL",
  trader: "ABROWN",
  side: "BUY",
  quantity: 25,
  price: 152.75,
  book: "EQUITIES_UK",
  counterparty: "Bank",
  tradeTimestamp: "2026-08-18T09:15:23Z",
};
let token: string;
let firstUserId: number;
let secondUserId: number;
const login = (username = credentials.username) =>
  request(app).post("/api/auth/login").send({ username, password });
const record = (accessToken: string, body = input) =>
  request(app).post("/api/trades").auth(accessToken, { type: "bearer" }).send(body);

beforeAll(async () => {
  await db.query("INSERT INTO counterparties(name) VALUES ('Bank') ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO instruments (symbol,name) VALUES ('AAPL','Apple')");
  await db.query("INSERT INTO traders (trader_code,name) VALUES ('ABROWN','Alex Brown')");
  const hash = await hashPassword(password);
  const users = await db.query<{ id: number }>(
    `INSERT INTO users (user_name,name,password_hash,created_at,updated_at)
    VALUES ('recorder-one','Recorder One',$1,NOW(),NOW()), ('recorder-two','Recorder Two',$1,NOW(),NOW()) RETURNING id`,
    [hash],
  );
  firstUserId = users.rows[0]!.id;
  secondUserId = users.rows[1]!.id;
});
beforeEach(async () => {
  await db.query("DELETE FROM trades");
  await db.query("DELETE FROM sessions");
  const response = await login();
  expect(response.status).toBe(200);
  token = response.body.accessToken;
});

describe("recording trades through the public API", () => {
  it("loads reference options, records a trade, and retrieves the same record without authentication", async () => {
    const instruments = await request(app).get("/api/instruments");
    const traders = await request(app).get("/api/traders");
    const options = await request(app).get("/api/trades/options");
    expect(instruments.status).toBe(200);
    expect(traders.status).toBe(200);
    expect(options.status).toBe(200);
    expect(options.body.symbols).toContain(instruments.body[0].symbol);
    expect(options.body.traders).toContain(traders.body[0].traderCode);
    const created = await record(token, {
      ...input,
      symbol: instruments.body[0].symbol,
      trader: traders.body[0].traderCode,
    });
    expect(created.status).toBe(201);
    expect(created.body.recordedById).toBe(String(firstUserId));
    const detail = await request(app).get(`/api/trades/${created.body.tradeId}`);
    const list = await request(app).get("/api/trades?limit=1&offset=0");
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual(created.body);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({
      trades: [created.body],
      pagination: { limit: 1, offset: 0, total: 1 },
    });
  });
  it("records the actual logged-in recorder independently of the selected trader", async () => {
    const secondLogin = await login("recorder-two");
    expect(secondLogin.status).toBe(200);
    const first = await record(token);
    const second = await record(secondLogin.body.accessToken);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.trader).toBe(second.body.trader);
    expect(first.body.recordedById).toBe(String(firstUserId));
    expect(second.body.recordedById).toBe(String(secondUserId));
    const rows = (await db.query("SELECT recorded_by_id FROM trades ORDER BY id")).rows;
    expect(rows.map((row) => row.recorded_by_id)).toEqual([firstUserId, secondUserId]);
  });
  it("rejects an expired session without recording another trade while reads remain public", async () => {
    expect((await record(token)).status).toBe(201);
    await db.query("UPDATE sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=$1", [
      hashToken(token),
    ]);
    const response = await record(token);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required.", code: "UNAUTHORIZED" });
    const list = await request(app).get("/api/trades");
    expect(list.status).toBe(200);
    expect(list.body.pagination.total).toBe(1);
  });
  it("prevents new recordings after logout without removing already recorded trades", async () => {
    const created = await record(token);
    expect(created.status).toBe(201);
    expect(
      (await request(app).post("/api/auth/logout").auth(token, { type: "bearer" })).status,
    ).toBe(204);
    expect((await record(token)).status).toBe(401);
    expect((await request(app).get(`/api/trades/${created.body.tradeId}`)).body).toEqual(
      created.body,
    );
    expect((await db.query("SELECT COUNT(*) FROM trades")).rows[0].count).toBe("1");
  });
  it("returns actionable reference errors and preserves previously recorded trades", async () => {
    expect((await record(token)).status).toBe(201);
    for (const [field, value, message] of [
      ["symbol", "UNKNOWN", "Unknown symbol."],
      ["trader", "UNKNOWN", "Unknown trader code."],
    ]) {
      const response = await record(token, { ...input, [field!]: value });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "Invalid request.",
        code: "VALIDATION_ERROR",
        fieldErrors: { [field!]: [message] },
      });
    }
    expect((await db.query("SELECT COUNT(*) FROM trades")).rows[0].count).toBe("1");
  });
  it.each([
    [
      "instrument",
      "DELETE FROM instruments WHERE id = NEW.symbol_id;",
      400,
      {
        error: "Invalid request.",
        code: "VALIDATION_ERROR",
        fieldErrors: { symbol: ["Unknown symbol."] },
      },
    ],
    [
      "trader",
      "DELETE FROM traders WHERE id = NEW.trader_id;",
      400,
      {
        error: "Invalid request.",
        code: "VALIDATION_ERROR",
        fieldErrors: { trader: ["Unknown trader code."] },
      },
    ],
    [
      "recorder",
      "DELETE FROM users WHERE id = NEW.recorded_by_id;",
      401,
      { error: "Authentication required.", code: "UNAUTHORIZED" },
    ],
  ] as const)(
    "translates a removed %s during insert and rolls back the failed recording",
    async (_reference, deletion, status, body) => {
      // Delete inside the insert transaction after the service has resolved its references.
      await db.query(`CREATE FUNCTION remove_recording_reference() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN ${deletion} RETURN NEW; END; $$`);
      await db.query(
        "CREATE TRIGGER remove_recording_reference BEFORE INSERT ON trades FOR EACH ROW EXECUTE FUNCTION remove_recording_reference()",
      );
      try {
        const failed = await record(token);
        expect(failed.status).toBe(status);
        expect(failed.body).toEqual(body);
        if (status === 401) expect(failed.headers["www-authenticate"]).toBe("Bearer");
        expect((await db.query("SELECT COUNT(*) FROM trades")).rows[0].count).toBe("0");
        expect((await db.query("SELECT COUNT(*) FROM instruments")).rows[0].count).toBe("1");
        expect((await db.query("SELECT COUNT(*) FROM traders")).rows[0].count).toBe("1");
        expect((await db.query("SELECT COUNT(*) FROM users")).rows[0].count).toBe("2");
        expect((await db.query("SELECT COUNT(*) FROM sessions")).rows[0].count).toBe("1");
      } finally {
        await db.query("DROP TRIGGER remove_recording_reference ON trades");
        await db.query("DROP FUNCTION remove_recording_reference()");
      }
      expect((await record(token)).status).toBe(201);
    },
  );
  it("rolls back a failed insert, returns a safe 500, and can record again after recovery", async () => {
    // Simulate a database outage at the INSERT without replacing any application code.
    await db.query(`CREATE FUNCTION reject_recording() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'private database failure'; END; $$`);
    await db.query(
      "CREATE TRIGGER reject_recording BEFORE INSERT ON trades FOR EACH ROW EXECUTE FUNCTION reject_recording()",
    );
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failed = await record(token);
      expect(failed.status).toBe(500);
      expect(failed.body).toEqual({ error: "Internal server error.", code: "INTERNAL_ERROR" });
      expect((await db.query("SELECT COUNT(*) FROM trades")).rows[0].count).toBe("0");
    } finally {
      logger.mockRestore();
      await db.query("DROP TRIGGER reject_recording ON trades");
      await db.query("DROP FUNCTION reject_recording()");
    }
    expect((await record(token)).status).toBe(201);
  });
});
