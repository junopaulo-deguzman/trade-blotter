import { createHash, randomBytes } from "node:crypto";
import { DatabaseError } from "pg";
import {
  selectUserByUsername,
  insertSession,
  selectSession,
  deleteSession,
  provisionUser,
} from "./auth.repository.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import type { LoginInput, LoginResponse, AuthContext, ProvisionUserInput } from "./auth.types.ts";
import { AuthError } from "./auth.errors.ts";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function login(input: LoginInput): Promise<LoginResponse> {
  const user = await selectUserByUsername(input.username);
  const valid = await verifyPassword(input.password, user?.password_hash ?? null);
  if (!valid || !user) throw new AuthError({ reason: "invalid_credentials" });
  const accessToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await insertSession(user.id, hashToken(accessToken), expiresAt);
  return {
    accessToken,
    tokenType: "Bearer",
    expiresAt: expiresAt.toISOString(),
    user: { id: user.id, username: user.user_name, name: user.name },
  };
}

export async function authenticate(token: string): Promise<AuthContext> {
  const tokenHash = hashToken(token);
  const session = await selectSession(tokenHash);
  if (!session || session.expires_at.getTime() <= Date.now()) {
    throw new AuthError({ reason: "invalid_session" });
  }
  return {
    tokenHash,
    user: { id: session.user_id, username: session.user_name, name: session.name },
  };
}

export async function logout(tokenHash: string): Promise<void> {
  await deleteSession(tokenHash);
}

export async function provisionAccount(input: ProvisionUserInput, reset = false): Promise<void> {
  try {
    const saved = await provisionUser(
      input.username,
      input.name,
      await hashPassword(input.password),
      reset,
    );
    if (!saved) throw new AuthError({ reason: "user_not_found", username: input.username });
  } catch (error) {
    if (
      error instanceof DatabaseError &&
      error.code === "23505" &&
      error.constraint === "users_user_name_key"
    ) {
      throw new AuthError({ reason: "username_already_exists", username: input.username });
    }
    throw error;
  }
}
