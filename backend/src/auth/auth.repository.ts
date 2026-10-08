import { db } from "../../db/connection.ts";
import type { UserRow, SessionRow } from "./auth.types.ts";
import { transaction } from "../shared/transaction.ts";

export const selectUserByUsername = async (username: string): Promise<UserRow | null> =>
  (
    await db.query<UserRow>(
      "SELECT id, user_name, name, password_hash FROM users WHERE user_name = $1",
      [username],
    )
  ).rows[0] ?? null;

export const insertSession = async (
  userId: number,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> => {
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)", [
    tokenHash,
    userId,
    expiresAt,
  ]);
};

export const selectSession = async (tokenHash: string): Promise<SessionRow | null> =>
  (
    await db.query<SessionRow>(
      `SELECT u.id AS user_id, u.user_name, u.name, s.expires_at
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [tokenHash],
    )
  ).rows[0] ?? null;

export const deleteSession = async (tokenHash: string): Promise<void> => {
  await db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
};

export async function provisionUser(
  username: string,
  name: string,
  passwordHash: string,
  reset = false,
): Promise<boolean> {
  if (reset) {
    return transaction(async (client) => {
      const result = await client.query<{ id: number }>(
        "UPDATE users SET password_hash = $2, updated_at = NOW() WHERE user_name = $1 RETURNING id",
        [username, passwordHash],
      );
      const user = result.rows[0];
      if (!user) return false;
      await client.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
      return true;
    });
  }
  await db.query(
    "INSERT INTO users (user_name, name, password_hash, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())",
    [username, name, passwordHash],
  );
  return true;
}
