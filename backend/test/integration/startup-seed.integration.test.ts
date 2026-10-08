import { afterEach, beforeEach, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../../src/app.ts";
import { db } from "../../db/connection.ts";
import { seedTradesOnStartup } from "../../src/startup/seed-trades.ts";
import { verifyPassword } from "../../src/auth/password.ts";

afterEach(() => vi.unstubAllEnvs());

beforeEach(async () => {
  vi.stubEnv("SEED_RECORDER_PASSWORD", "");
  await db.query("TRUNCATE trades, sessions, instruments, traders, users RESTART IDENTITY CASCADE");
});

it("persists exactly 1000 varied, valid trades on an empty database", async () => {
  const started = Date.now();
  expect(await seedTradesOnStartup()).toBe(1000);
  const { rows } = await db.query(`SELECT tr.*, i.symbol, t.trader_code
    FROM trades tr JOIN instruments i ON i.id = tr.symbol_id JOIN traders t ON t.id = tr.trader_id`);
  expect(rows).toHaveLength(1000);
  expect(new Set(rows.map((row) => row.id)).size).toBe(1000);
  expect(new Set(rows.map((row) => row.symbol)).size).toBe(5);
  const referenceTraders = (await db.query("SELECT trader_code FROM traders")).rows;
  expect(new Set(rows.map((row) => row.trader_code))).toEqual(
    new Set(referenceTraders.map((row) => row.trader_code)),
  );
  expect(referenceTraders.length).toBeGreaterThan(1);
  expect(new Set(rows.map((row) => row.side))).toEqual(new Set(["BUY", "SELL"]));
  expect(new Set(rows.map((row) => row.status))).toEqual(new Set(["ACTIVE", "CANCELLED"]));
  expect(new Set(rows.map((row) => row.price)).size).toBeGreaterThan(100);
  expect(new Set(rows.map((row) => row.book)).size).toBe(3);
  const holdings = (await db.query("SELECT * FROM opening_holdings")).rows;
  expect(holdings).toHaveLength(15);
  expect(holdings.every((holding) => holding.quantity >= 50000 && holding.quantity <= 200000)).toBe(
    true,
  );
  const books = (await db.query("SELECT code FROM books")).rows.map((row) => row.code);
  expect(rows.every((row) => books.includes(row.book))).toBe(true);
  expect(new Set(rows.map((row) => row.counterparty)).size).toBe(5);
  for (const row of rows) {
    expect(row.quantity).toBeGreaterThan(0);
    expect(Number.isInteger(row.quantity)).toBe(true);
    expect(Number(row.price)).toBeGreaterThan(0);
    expect(row.trade_timestamp.getTime()).toBeLessThan(started);
    expect(row.trade_timestamp.getTime()).toBeGreaterThan(started - 30 * 86400_000);
    expect([0, 6]).not.toContain(row.trade_timestamp.getUTCDay());
  }
  const user = (await db.query("SELECT * FROM users")).rows[0];
  expect(user.user_name).toBe("seed-recorder");
  expect(await verifyPassword("LOGIN_DISABLED", user.password_hash)).toBe(false);
  expect(rows.every((row) => row.recorded_by_id === user.id)).toBe(true);
});

it("preserves trades on repeated starts, even if fewer than 1000 remain", async () => {
  await seedTradesOnStartup();
  await db.query("DELETE FROM trades WHERE id > 1");
  const before = (await db.query("SELECT * FROM trades")).rows;
  const holdings = (await db.query("SELECT * FROM opening_holdings ORDER BY book_code, symbol_id"))
    .rows;
  expect(await seedTradesOnStartup()).toBe(0);
  expect((await db.query("SELECT * FROM trades")).rows).toEqual(before);
  expect(
    (await db.query("SELECT * FROM opening_holdings ORDER BY book_code, symbol_id")).rows,
  ).toEqual(holdings);
});

it("serializes concurrent startup initialization", async () => {
  const counts = await Promise.all([seedTradesOnStartup(), seedTradesOnStartup()]);
  expect(counts.sort((a, b) => a - b)).toEqual([0, 1000]);
  expect((await db.query("SELECT COUNT(*)::int AS count FROM trades")).rows[0].count).toBe(1000);
  expect((await db.query("SELECT COUNT(*)::int AS count FROM users")).rows[0].count).toBe(1);
});

it("reuses existing accounts and reference records without changing their data", async () => {
  const user = (
    await db.query(`INSERT INTO users (user_name, name, password_hash, created_at, updated_at)
    VALUES ('recorder', 'Recorder', 'preserve-this-hash', NOW(), NOW()) RETURNING *`)
  ).rows[0];
  await db.query("INSERT INTO instruments (symbol, name) VALUES ('AAPL', 'Custom Apple name')");
  await db.query("INSERT INTO traders (trader_code, name) VALUES ('JSMITH', 'Custom trader name')");
  expect(await seedTradesOnStartup()).toBe(1000);
  expect((await db.query("SELECT * FROM users")).rows).toEqual([user]);
  expect((await db.query("SELECT name FROM instruments WHERE symbol = 'AAPL'")).rows[0].name).toBe(
    "Custom Apple name",
  );
  expect(
    (await db.query("SELECT name FROM traders WHERE trader_code = 'JSMITH'")).rows[0].name,
  ).toBe("Custom trader name");
  expect((await db.query("SELECT DISTINCT recorded_by_id FROM trades")).rows).toEqual([
    { recorded_by_id: user.id },
  ]);
});

it("rolls back all initialization when trade persistence fails, then recovers", async () => {
  await db.query("ALTER TABLE trades ADD CONSTRAINT reject_seed CHECK (quantity < 0) NOT VALID");
  try {
    await expect(seedTradesOnStartup()).rejects.toMatchObject({ code: "23514" });
    for (const table of ["trades", "users", "instruments", "traders", "opening_holdings"]) {
      expect((await db.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count).toBe(0);
    }
  } finally {
    await db.query("ALTER TABLE trades DROP CONSTRAINT reject_seed");
  }
  expect(await seedTradesOnStartup()).toBe(1000);
});

it("enables seed-recorder from configuration and never resets an enabled password", async () => {
  await seedTradesOnStartup();
  vi.stubEnv("SEED_RECORDER_PASSWORD", "private-demo-password");
  expect(await seedTradesOnStartup()).toBe(0);
  const user = (await db.query("SELECT * FROM users WHERE user_name = 'seed-recorder'")).rows[0];
  expect(await verifyPassword("private-demo-password", user.password_hash)).toBe(true);
  vi.stubEnv("SEED_RECORDER_PASSWORD", "another-demo-password");
  expect(await seedTradesOnStartup()).toBe(0);
  expect(
    (await db.query("SELECT password_hash FROM users WHERE id = $1", [user.id])).rows[0]
      .password_hash,
  ).toBe(user.password_hash);
});
it("creates the configured demo account and assigns fresh seeds to it", async () => {
  await db.query(`INSERT INTO users (user_name, name, password_hash, created_at, updated_at)
    VALUES ('existing', 'Existing', 'LOGIN_DISABLED', NOW(), NOW())`);
  vi.stubEnv("SEED_RECORDER_PASSWORD", "private-demo-password");
  expect(await seedTradesOnStartup()).toBe(1000);
  const user = (await db.query("SELECT * FROM users WHERE user_name = 'seed-recorder'")).rows[0];
  expect(await verifyPassword("private-demo-password", user.password_hash)).toBe(true);
  expect((await db.query("SELECT DISTINCT recorded_by_id FROM trades")).rows).toEqual([
    { recorded_by_id: user.id },
  ]);
});
it("rejects invalid demo password configuration without database changes", async () => {
  vi.stubEnv("SEED_RECORDER_PASSWORD", "short");
  await expect(seedTradesOnStartup()).rejects.toThrow(
    "Invalid SEED_RECORDER_PASSWORD configuration",
  );
  expect((await db.query("SELECT COUNT(*)::int AS count FROM users")).rows[0].count).toBe(0);
});

it("logs in through the real HTTP endpoint after startup enables an existing disabled account", async () => {
  await seedTradesOnStartup();
  vi.stubEnv("SEED_RECORDER_PASSWORD", "private-demo-password");
  expect(await seedTradesOnStartup()).toBe(0);
  const response = await request(app)
    .post("/api/auth/login")
    .send({ username: "seed-recorder", password: "private-demo-password" });
  expect(response.status).toBe(200);
  expect(response.body.user.username).toBe("seed-recorder");
  const me = await request(app)
    .get("/api/auth/me")
    .auth(response.body.accessToken, { type: "bearer" });
  expect(me.status).toBe(200);
  expect(me.body.username).toBe("seed-recorder");
  const logout = await request(app)
    .post("/api/auth/logout")
    .auth(response.body.accessToken, { type: "bearer" });
  expect(logout.status).toBe(204);
});
