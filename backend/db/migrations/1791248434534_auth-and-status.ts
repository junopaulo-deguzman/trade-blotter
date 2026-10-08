import type { MigrationBuilder } from "node-pg-migrate";
export const up = (pgm: MigrationBuilder) => {
  pgm.renameColumn("users", "password", "password_hash");
  // Legacy values are preserved, but are deliberately unsupported by the verifier.
  pgm.sql("UPDATE trades SET status = 'ACTIVE' WHERE status IS NULL");
  pgm.alterColumn("trades", "status", { notNull: true, default: "ACTIVE" });
  pgm.createTable("sessions", {
    token_hash: { type: "text", primaryKey: true },
    user_id: { type: "integer", notNull: true, references: "users(id)", onDelete: "CASCADE" },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("sessions", "user_id");
  pgm.createIndex("sessions", "expires_at");
};
export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable("sessions");
  pgm.alterColumn("trades", "status", { notNull: false });
  pgm.renameColumn("users", "password_hash", "password");
};
