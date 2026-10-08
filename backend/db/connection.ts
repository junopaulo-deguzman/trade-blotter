import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const schema = process.env.TEST_DATABASE_SCHEMA;
if (schema && (process.env.NODE_ENV !== "test" || !/^vitest_[a-f0-9]{32}$/.test(schema))) {
  throw new Error("TEST_DATABASE_SCHEMA is reserved for isolated test schemas.");
}

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: schema ? `-c search_path=${schema}` : undefined,
});

db.on("error", () => {
  console.error("Unexpected database pool error");
});
