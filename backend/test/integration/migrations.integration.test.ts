import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { runner } from "node-pg-migrate";
import { db } from "../../db/connection.ts";
import { verifyPassword } from "../../src/auth/password.ts";

const migrate = (direction: "up" | "down", count?: number) =>
  runner({
    databaseUrl: process.env.TEST_DATABASE_URL!,
    dir: fileURLToPath(new URL("../../db/migrations", import.meta.url)),
    direction,
    count,
    schema: process.env.TEST_DATABASE_SCHEMA!,
    migrationsSchema: process.env.TEST_DATABASE_SCHEMA!,
    migrationsTable: "pgmigrations",
    noLock: true,
    log: () => {},
  });

it("preserves legacy users/trades, backfills status, enforces constraints, and rolls back cleanly", async () => {
  await migrate("down", 3);
  const instrument = await db.query<{ id: number }>(
    "INSERT INTO instruments (symbol,name) VALUES ('AAPL','Apple') RETURNING id",
  );
  const trader = await db.query<{ id: number }>(
    "INSERT INTO traders (trader_code,name) VALUES ('ABROWN','Alex') RETURNING id",
  );
  const user = await db.query<{ id: number }>(
    "INSERT INTO users (user_name,name,password,created_at,updated_at) VALUES ('legacy','Legacy','old-plaintext',NOW(),NOW()) RETURNING id",
  );
  const parameters = [instrument.rows[0]!.id, trader.rows[0]!.id, user.rows[0]!.id];
  await db.query(
    `INSERT INTO trades
    (symbol_id,trader_id,recorded_by_id,side,quantity,price,book,counterparty,trade_timestamp,status)
    VALUES ($1,$2,$3,'BUY',1,10,'UK','Bank','2026-08-18T00:00:00Z',NULL)`,
    parameters,
  );
  await migrate("up", 1);
  const savedUser = (await db.query("SELECT * FROM users")).rows[0];
  expect(savedUser.password_hash).toBe("old-plaintext");
  expect(savedUser.id).toBe(user.rows[0]!.id);
  expect(await verifyPassword("old-plaintext", savedUser.password_hash)).toBe(false);
  const savedTrade = (await db.query("SELECT * FROM trades")).rows[0];
  expect(savedTrade.status).toBe("ACTIVE");
  expect(savedTrade.recorded_by_id).toBe(user.rows[0]!.id);
  expect(savedTrade.price).toBe("10");
  expect(savedTrade.trade_timestamp.toISOString()).toBe("2026-08-18T00:00:00.000Z");
  await expect(db.query("UPDATE trades SET status = NULL")).rejects.toMatchObject({
    code: "23502",
  });
  await expect(db.query("UPDATE trades SET quantity = 0")).rejects.toMatchObject({ code: "23514" });
  await expect(db.query("UPDATE trades SET symbol_id = 2147483647")).rejects.toMatchObject({
    code: "23503",
  });
  await migrate("down", 2);
  const tables = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('trades','users','instruments','traders','sessions')",
    [process.env.TEST_DATABASE_SCHEMA],
  );
  expect(tables.rows).toEqual([]);
});

it("resets demo trades for the book schema while preserving accounts and enforcing holding references", async () => {
  await migrate("up");
  const instrument = (
    await db.query("INSERT INTO instruments(symbol,name) VALUES ('AAPL','Apple') RETURNING id")
  ).rows[0];
  const trader = (
    await db.query("INSERT INTO traders(trader_code,name) VALUES ('TEST','Test') RETURNING id")
  ).rows[0];
  const user = (
    await db.query(
      "INSERT INTO users(user_name,name,password_hash,created_at,updated_at) VALUES ('keep','Keep','LOGIN_DISABLED',NOW(),NOW()) RETURNING *",
    )
  ).rows[0];
  await db.query(
    `INSERT INTO trades(symbol_id,trader_id,recorded_by_id,side,quantity,price,book,counterparty,trade_timestamp)
    VALUES($1,$2,$3,'BUY',10,100,'EQUITIES_UK','Goldman Sachs',NOW())`,
    [instrument.id, trader.id, user.id],
  );
  await migrate("down", 2);
  expect((await db.query("SELECT COUNT(*)::int AS total FROM trades")).rows[0].total).toBe(1);
  await migrate("up", 1);
  expect((await db.query("SELECT COUNT(*)::int AS total FROM trades")).rows[0].total).toBe(0);
  expect((await db.query("SELECT * FROM users WHERE id=$1", [user.id])).rows[0]).toEqual(user);
  await db.query(
    "INSERT INTO opening_holdings(book_code,symbol_id,quantity) VALUES('EQUITIES_UK',$1,500)",
    [instrument.id],
  );
  await expect(
    db.query("INSERT INTO opening_holdings(book_code,symbol_id,quantity) VALUES('UNKNOWN',$1,1)", [
      instrument.id,
    ]),
  ).rejects.toMatchObject({ code: "23503" });
  await expect(db.query("UPDATE opening_holdings SET quantity=-1")).rejects.toMatchObject({
    code: "23514",
  });
  await expect(
    db.query(
      "INSERT INTO opening_holdings(book_code,symbol_id,quantity) VALUES('EQUITIES_UK',$1,1)",
      [instrument.id],
    ),
  ).rejects.toMatchObject({ code: "23505" });
});

it("adds counterparty references without resetting trades and backfills existing names", async () => {
  await db.query(`INSERT INTO trades(symbol_id,trader_id,recorded_by_id,side,quantity,price,book,counterparty,trade_timestamp)
    SELECT i.id,t.id,u.id,'BUY',10,100,'EQUITIES_UK','Custom Bank',NOW()
    FROM instruments i CROSS JOIN traders t CROSS JOIN users u LIMIT 1`);
  const before = (await db.query("SELECT * FROM trades")).rows;
  expect(before).toHaveLength(1);
  await migrate("up", 1);
  expect((await db.query("SELECT * FROM trades")).rows).toEqual(before);
  expect(
    (await db.query("SELECT name FROM counterparties WHERE name='Custom Bank'")).rowCount,
  ).toBe(1);
  await expect(db.query("UPDATE trades SET counterparty='UNKNOWN'")).rejects.toMatchObject({
    code: "23503",
  });
  await db.query("DELETE FROM trades");
  expect((await db.query("SELECT COUNT(*)::int AS total FROM counterparties")).rows[0].total).toBe(
    6,
  );
});
