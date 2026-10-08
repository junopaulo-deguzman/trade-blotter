import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import { Pool } from "pg";
import { runner } from "node-pg-migrate";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must point to a dedicated test database.");
if (!new URL(url).pathname.slice(1).endsWith("_test"))
  throw new Error("Test database name must end in _test.");
const schema = `vitest_${randomUUID().replaceAll("-", "")}`;
process.env.DATABASE_URL = url;
process.env.TEST_DATABASE_SCHEMA = schema;
const admin = new Pool({ connectionString: url });
await admin.query(`CREATE SCHEMA "${schema}"`);
try {
  await runner({
    databaseUrl: url,
    dir: fileURLToPath(new URL("../../db/migrations", import.meta.url)),
    direction: "up",
    migrationsTable: "pgmigrations",
    schema,
    migrationsSchema: schema,
    noLock: true,
    log: () => {},
  });
} catch (error) {
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
  throw error;
}
const { db } = await import("../../db/connection.ts");
afterAll(async () => {
  await db.end();
  try {
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  } finally {
    await admin.end();
  }
});
