import type { MigrationBuilder } from "node-pg-migrate";

export const up = (pgm: MigrationBuilder) => {
  // One-time demo reset authorized for this schema change. Accounts are retained.
  pgm.sql("TRUNCATE trades RESTART IDENTITY");
  pgm.createTable("books", {
    code: { type: "text", primaryKey: true, check: "length(trim(code)) > 0" },
    name: { type: "text", notNull: true, check: "length(trim(name)) > 0" },
  });
  pgm.sql(`INSERT INTO books (code, name) VALUES
    ('EQUITIES_UK', 'UK Equities'), ('EQUITIES_US', 'US Equities'), ('TECH_GROWTH', 'Technology Growth')`);
  pgm.addConstraint("trades", "fk_trade_book_code", {
    foreignKeys: { columns: "book", references: "books(code)", onDelete: "RESTRICT" },
  });
  pgm.createTable("opening_holdings", {
    book_code: { type: "text", notNull: true, references: "books(code)", onDelete: "RESTRICT" },
    symbol_id: {
      type: "integer",
      notNull: true,
      references: "instruments(id)",
      onDelete: "RESTRICT",
    },
    quantity: { type: "integer", notNull: true, check: "quantity >= 0" },
  });
  pgm.addConstraint("opening_holdings", "opening_holdings_pkey", {
    primaryKey: ["book_code", "symbol_id"],
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable("opening_holdings");
  pgm.dropConstraint("trades", "fk_trade_book_code");
  pgm.dropTable("books");
};
