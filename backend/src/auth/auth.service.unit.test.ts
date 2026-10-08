import { DatabaseError } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { login, authenticate, logout, hashToken, provisionAccount } from "./auth.service.ts";
import * as repo from "./auth.repository.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { AuthError } from "./auth.errors.ts";
vi.mock("./auth.repository.ts", () => ({
  selectUserByUsername: vi.fn(),
  insertSession: vi.fn(),
  selectSession: vi.fn(),
  deleteSession: vi.fn(),
  provisionUser: vi.fn(),
}));
vi.mock("./password.ts", () => ({ verifyPassword: vi.fn(), hashPassword: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
describe("bearer sessions", () => {
  it("returns an opaque token and stores only its hash", async () => {
    vi.mocked(repo.selectUserByUsername).mockResolvedValue({
      id: 3,
      user_name: "alex",
      name: "Alex",
      password_hash: "hash",
    });
    vi.mocked(verifyPassword).mockResolvedValue(true);
    const response = await login({ username: "alex", password: "password" });
    expect(response.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.user).toEqual({ id: 3, username: "alex", name: "Alex" });
    expect(repo.insertSession).toHaveBeenCalledWith(
      3,
      hashToken(response.accessToken),
      new Date(response.expiresAt),
    );
    expect(new Date(response.expiresAt).getTime() - Date.now()).toBeGreaterThan(8 * 3600000 - 1000);
  });
  it("gives identical errors for unknown users and incorrect passwords", async () => {
    vi.mocked(repo.selectUserByUsername)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 3, user_name: "alex", name: "Alex", password_hash: "hash" });
    vi.mocked(verifyPassword).mockResolvedValue(false);
    for (let i = 0; i < 2; i++)
      await expect(login({ username: "alex", password: "bad" })).rejects.toMatchObject({
        constructor: AuthError,
        failure: { reason: "invalid_credentials" },
        message: "Invalid username or password.",
      });
    expect(verifyPassword).toHaveBeenCalledWith("bad", null);
    expect(repo.insertSession).not.toHaveBeenCalled();
  });
  it("resolves a valid session to the user context", async () => {
    vi.mocked(repo.selectSession).mockResolvedValue({
      user_id: 3,
      user_name: "alex",
      name: "Alex",
      expires_at: new Date(Date.now() + 10000),
    });
    await expect(authenticate("token")).resolves.toEqual({
      tokenHash: hashToken("token"),
      user: { id: 3, username: "alex", name: "Alex" },
    });
  });
  it("rejects missing/revoked and expired sessions", async () => {
    vi.mocked(repo.selectSession)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        user_id: 3,
        user_name: "alex",
        name: "Alex",
        expires_at: new Date(0),
      });
    for (let i = 0; i < 2; i++)
      await expect(authenticate("token")).rejects.toMatchObject({
        constructor: AuthError,
        failure: { reason: "invalid_session" },
      });
  });
  it("revokes the hashed session on logout", async () => {
    await logout("hash");
    expect(repo.deleteSession).toHaveBeenCalledWith("hash");
  });
  it("preserves unexpected session lookup and revocation failures", async () => {
    const error = new Error("connection lost");
    vi.mocked(repo.selectSession).mockRejectedValue(error);
    vi.mocked(repo.deleteSession).mockRejectedValue(error);
    await expect(authenticate("token")).rejects.toBe(error);
    await expect(logout("hash")).rejects.toBe(error);
  });
  it("preserves unexpected login persistence failures", async () => {
    vi.mocked(repo.selectUserByUsername).mockResolvedValue({
      id: 3,
      user_name: "alex",
      name: "Alex",
      password_hash: "hash",
    });
    vi.mocked(verifyPassword).mockResolvedValue(true);
    const error = new Error("connection lost");
    vi.mocked(repo.insertSession).mockRejectedValue(error);
    await expect(login({ username: "alex", password: "password" })).rejects.toBe(error);
  });
});

describe("account provisioning use cases", () => {
  const input = { username: "alex", name: "Alex", password: "new-password-123" };
  beforeEach(() => {
    vi.mocked(hashPassword).mockResolvedValue("password-hash");
  });
  it("creates an account with a hash instead of a plaintext password", async () => {
    vi.mocked(repo.provisionUser).mockResolvedValue(true);
    await provisionAccount(input);
    expect(repo.provisionUser).toHaveBeenCalledWith("alex", "Alex", "password-hash", false);
  });
  it("returns a username conflict only for the username constraint", async () => {
    const error = new DatabaseError("duplicate username", 0, "error");
    error.code = "23505";
    error.constraint = "users_user_name_key";
    vi.mocked(repo.provisionUser).mockRejectedValue(error);
    await expect(provisionAccount(input)).rejects.toMatchObject({
      constructor: AuthError,
      failure: { reason: "username_already_exists", username: input.username },
      message: "Username already exists.",
    });
    error.constraint = "users_pkey";
    await expect(provisionAccount(input)).rejects.toBe(error);
  });
  it("reports an absent account when explicitly resetting its password", async () => {
    vi.mocked(repo.provisionUser).mockResolvedValue(false);
    await expect(provisionAccount(input, true)).rejects.toMatchObject({
      constructor: AuthError,
      failure: { reason: "user_not_found", username: input.username },
      message: "User not found.",
    });
  });
});
