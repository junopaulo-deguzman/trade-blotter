import type { MigrationBuilder } from "node-pg-migrate";

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable("trades", {
    id: { type: "serial", primaryKey: true },
    symbol_id: { type: "int", notNull: true },
    side: { type: "string", notNull: true, check: "side IN ('BUY', 'SELL')" },
    quantity: { type: "int", notNull: true, check: "quantity > 0" },
    price: { type: "numeric", notNull: true, check: "price > 0" },
    trader_id: { type: "int", notNull: true },
    book: { type: "string", notNull: true },
    counterparty: { type: "string", notNull: true },
    trade_timestamp: { type: "timestamptz", notNull: true },
    status: { type: "string", default: "ACTIVE", check: "status IN ('ACTIVE', 'CANCELLED')" },
    recorded_by_id: { type: "int", notNull: true },
  });
  pgm.createTable("users", {
    id: { type: "serial", primaryKey: true },
    name: { type: "string", notNull: true },
    user_name: { type: "string", notNull: true, unique: true },
    password: { type: "string", notNull: true },
    created_at: { type: "timestamptz", notNull: true },
    updated_at: { type: "timestamptz", notNull: true },
  });
  pgm.createTable("instruments", {
    id: { type: "serial", primaryKey: true },
    symbol: { type: "string", notNull: true, unique: true },
    name: { type: "string", notNull: true },
  });
  pgm.createTable("traders", {
    id: { type: "serial", primaryKey: true },
    trader_code: { type: "string", notNull: true, unique: true },
    name: { type: "string", notNull: true },
  });
  pgm.addConstraint("trades", "fk_trade_recorded_by_id", {
    foreignKeys: {
      columns: "recorded_by_id",
      references: '"users"("id")',
      onDelete: "RESTRICT",
    },
  });
  pgm.addConstraint("trades", "fk_trade_trader_id", {
    foreignKeys: {
      columns: "trader_id",
      references: "traders(id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.addConstraint("trades", "fk_trade_symbol_id", {
    foreignKeys: {
      columns: "symbol_id",
      references: "instruments(id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.createIndex("trades", "trade_timestamp");
  pgm.createIndex("trades", ["trader_id", "trade_timestamp"]);
  pgm.createIndex("trades", ["book", "trade_timestamp"]);
  pgm.createIndex("trades", ["counterparty", "trade_timestamp"]);
  pgm.createIndex("trades", ["symbol_id", "trade_timestamp"]);
  pgm.createIndex("trades", ["recorded_by_id", "trade_timestamp"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm: MigrationBuilder) => {
  pgm.dropConstraint("trades", "fk_trade_recorded_by_id");
  pgm.dropConstraint("trades", "fk_trade_trader_id");
  pgm.dropConstraint("trades", "fk_trade_symbol_id");
  pgm.dropTable("trades");
  pgm.dropTable("traders");
  pgm.dropTable("instruments");
  pgm.dropTable("users");
};
