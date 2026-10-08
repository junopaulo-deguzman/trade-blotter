import type { MigrationBuilder } from "node-pg-migrate";

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable("counterparties", {
    name: { type: "text", primaryKey: true, check: "length(trim(name)) > 0" },
  });
  pgm.sql(`INSERT INTO counterparties (name) VALUES
    ('Goldman Sachs'), ('JP Morgan'), ('Morgan Stanley'), ('Barclays'), ('UBS');
    INSERT INTO counterparties (name) SELECT DISTINCT counterparty FROM trades ON CONFLICT DO NOTHING;`);
  pgm.addConstraint("trades", "fk_trade_counterparty_name", {
    foreignKeys: {
      columns: "counterparty",
      references: "counterparties(name)",
      onDelete: "RESTRICT",
    },
  });
};
export const down = (pgm: MigrationBuilder) => {
  pgm.dropConstraint("trades", "fk_trade_counterparty_name");
  pgm.dropTable("counterparties");
};
