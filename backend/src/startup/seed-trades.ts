import { randomInt } from "node:crypto";
import { hashPassword } from "../auth/password.ts";
import { provisionUserSchema } from "../auth/auth.types.ts";
import { transaction } from "../shared/transaction.ts";

const instruments = [
  { symbol: "AAPL", name: "Apple", price: 227.45 },
  { symbol: "MSFT", name: "Microsoft", price: 534.22 },
  { symbol: "TSLA", name: "Tesla", price: 341.75 },
  { symbol: "NVDA", name: "NVIDIA", price: 180 },
  { symbol: "AMZN", name: "Amazon", price: 220 },
];
const traders = [
  { code: "JSMITH", name: "Jamie Smith" },
  { code: "ABROWN", name: "Alex Brown" },
  { code: "MJONES", name: "Morgan Jones" },
  { code: "LWHITE", name: "Liam White" },
  { code: "KJOHNSON", name: "Kate Johnson" },
  { code: "DLEE", name: "Daniel Lee" },
  { code: "SMILLER", name: "Samantha Miller" },
  { code: "JDOE", name: "John Doe" },
  { code: "MWILSON", name: "Mia Wilson" },
  { code: "JBROWN", name: "James Brown" },
  { code: "CJONES", name: "Charlotte Jones" },
  { code: "BWILLIAMS", name: "Benjamin Williams" },
  { code: "AJACKSON", name: "Alice Jackson" },
  { code: "BTHOMPSON", name: "Brian Thompson" },
  { code: "CROBINSON", name: "Chloe Robinson" },
  { code: "DCLARK", name: "David Clark" },
  { code: "EMARTIN", name: "Emma Martin" },
  { code: "FTHOMAS", name: "Frank Thomas" },
  { code: "GCLARK", name: "Grace Clark" },
  { code: "HHARRIS", name: "Henry Harris" },
  { code: "IJACKSON", name: "Isabella Jackson" },
  { code: "JLEWIS", name: "Jack Lewis" },
  { code: "KMARTIN", name: "Kevin Martin" },
  { code: "LNELSON", name: "Laura Nelson" },
  { code: "MPARKER", name: "Michael Parker" },
  { code: "NROBINSON", name: "Natalie Robinson" },
];
const books = [
  { code: "EQUITIES_UK", name: "UK Equities" },
  { code: "EQUITIES_US", name: "US Equities" },
  { code: "TECH_GROWTH", name: "Technology Growth" },
];
const counterparties = ["Goldman Sachs", "JP Morgan", "Morgan Stanley", "Barclays", "UBS"];
const choose = <T>(values: T[]): T => values[randomInt(values.length)]!;

/** Run before accepting requests. Seed only an empty blotter, atomically. */
export async function seedTradesOnStartup(): Promise<number> {
  const password = process.env.SEED_RECORDER_PASSWORD || undefined;
  if (password !== undefined) {
    const result = provisionUserSchema.safeParse({
      username: "seed-recorder",
      name: "Demo Recorder",
      password,
    });
    if (!result.success) throw new Error("Invalid SEED_RECORDER_PASSWORD configuration");
  }

  return transaction(async (client) => {
    // Serializes concurrent startup seeders and blocks writes until initialization commits.
    await client.query("LOCK TABLE trades IN SHARE ROW EXCLUSIVE MODE");
    if (password !== undefined) {
      const account = (
        await client.query<{ password_hash: string }>(
          "SELECT password_hash FROM users WHERE user_name = 'seed-recorder' FOR UPDATE",
        )
      ).rows[0];
      if (!account || account.password_hash === "LOGIN_DISABLED") {
        const hash = await hashPassword(password);
        await client.query(
          `INSERT INTO users (user_name, name, password_hash, created_at, updated_at)
           VALUES ('seed-recorder', 'Demo Recorder', $1, NOW(), NOW())
           ON CONFLICT (user_name) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = NOW()
           WHERE users.password_hash = 'LOGIN_DISABLED'`,
          [hash],
        );
      }
    }
    for (const counterparty of counterparties) {
      await client.query("INSERT INTO counterparties (name) VALUES ($1) ON CONFLICT DO NOTHING", [
        counterparty,
      ]);
    }
    const existing = await client.query("SELECT 1 FROM trades LIMIT 1");
    if (existing.rowCount) return 0;

    const symbols: { id: number; price: number }[] = [];
    for (const instrument of instruments) {
      const result = await client.query<{ id: number }>(
        `INSERT INTO instruments (symbol, name) VALUES ($1, $2)
         ON CONFLICT (symbol) DO UPDATE SET symbol = EXCLUDED.symbol RETURNING id`,
        [instrument.symbol, instrument.name],
      );
      symbols.push({ id: result.rows[0]!.id, price: instrument.price });
    }
    for (const book of books) {
      await client.query(
        `INSERT INTO books (code, name) VALUES ($1, $2)
        ON CONFLICT (code) DO NOTHING`,
        [book.code, book.name],
      );
      for (const symbol of symbols) {
        await client.query(
          `INSERT INTO opening_holdings (book_code, symbol_id, quantity)
          VALUES ($1, $2, $3) ON CONFLICT (book_code, symbol_id) DO NOTHING`,
          [book.code, symbol.id, randomInt(500, 2001) * 100],
        );
      }
    }
    const traderIds: number[] = [];
    for (const trader of traders) {
      const result = await client.query<{ id: number }>(
        `INSERT INTO traders (trader_code, name) VALUES ($1, $2)
         ON CONFLICT (trader_code) DO UPDATE SET trader_code = EXCLUDED.trader_code RETURNING id`,
        [trader.code, trader.name],
      );
      traderIds.push(result.rows[0]!.id);
    }
    // Reuse an existing recorder so its owner can amend/cancel the demo records.
    let user = (
      await client.query<{ id: number }>(
        "SELECT id FROM users ORDER BY CASE WHEN user_name = 'seed-recorder' AND $1::boolean THEN 0 ELSE 1 END, id LIMIT 1",
        [password !== undefined],
      )
    ).rows[0];
    if (!user) {
      user = (
        await client.query<{ id: number }>(
          `INSERT INTO users (user_name, name, password_hash, created_at, updated_at)
         VALUES ('seed-recorder', 'Demo Recorder', 'LOGIN_DISABLED', NOW(), NOW()) RETURNING id`,
        )
      ).rows[0]!;
    }
    const now = new Date();
    const rows = Array.from({ length: 1000 }, () => {
      const instrument = choose(symbols);
      const timestamp = new Date(now);
      timestamp.setUTCDate(timestamp.getUTCDate() - randomInt(1, 29));
      // Demo executions on weekdays between 08:00 and 17:00 UTC.
      if (timestamp.getUTCDay() === 0) timestamp.setUTCDate(timestamp.getUTCDate() - 2);
      if (timestamp.getUTCDay() === 6) timestamp.setUTCDate(timestamp.getUTCDate() - 1);
      timestamp.setUTCHours(8, randomInt(540), randomInt(60), 0);
      return {
        symbol_id: instrument.id,
        trader_id: choose(traderIds),
        recorded_by_id: user.id,
        side: randomInt(2) ? "BUY" : "SELL",
        quantity: randomInt(1, 101) * 100,
        price: Number(((instrument.price * randomInt(9000, 11001)) / 10000).toFixed(2)),
        book: choose(books).code,
        counterparty: choose(counterparties),
        trade_timestamp: timestamp.toISOString(),
        status: randomInt(10) === 0 ? "CANCELLED" : "ACTIVE",
      };
    });
    await client.query(
      `INSERT INTO trades
       (symbol_id, trader_id, recorded_by_id, side, quantity, price, book, counterparty, trade_timestamp, status)
       SELECT symbol_id, trader_id, recorded_by_id, side, quantity, price, book, counterparty, trade_timestamp, status
       FROM jsonb_to_recordset($1::jsonb) AS seed(
         symbol_id int, trader_id int, recorded_by_id int, side text, quantity int,
         price numeric, book text, counterparty text, trade_timestamp timestamptz, status text)`,
      [JSON.stringify(rows)],
    );
    return rows.length;
  });
}
