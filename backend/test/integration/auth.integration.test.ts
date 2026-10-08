import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.ts";
import { db } from "../../db/connection.ts";
import { hashToken, provisionAccount } from "../../src/auth/auth.service.ts";
import { AuthError } from "../../src/auth/auth.errors.ts";
let userId: number;
let passwordHash: string;
const credentials = { username: "recorder", password: "integration-password" };
beforeAll(async () => {
  await provisionAccount({ ...credentials, name: "Recorder" });
  passwordHash = (
    await db.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE user_name = $1",
      [credentials.username],
    )
  ).rows[0]!.password_hash;
  userId = (
    await db.query<{ id: number }>("SELECT id FROM users WHERE user_name = $1", [
      credentials.username,
    ])
  ).rows[0]!.id;
});
beforeEach(async () => {
  await db.query("DELETE FROM sessions");
  await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, userId]);
});
describe("authentication with PostgreSQL", () => {
  it("logs in, stores only a hash, resolves account identity, and revokes logout", async () => {
    const login = await request(app).post("/api/auth/login").send(credentials);
    expect(login.status).toBe(200);
    expect(login.headers["cache-control"]).toBe("no-store");
    expect(login.body).toMatchObject({
      tokenType: "Bearer",
      user: { id: userId, username: "recorder", name: "Recorder" },
    });
    expect(login.body.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = (
      await db.query("SELECT * FROM sessions WHERE token_hash = $1", [
        hashToken(login.body.accessToken),
      ])
    ).rows[0];
    expect(row.user_id).toBe(userId);
    expect(row.token_hash).not.toBe(login.body.accessToken);
    expect(row.expires_at.toISOString()).toBe(login.body.expiresAt);
    const me = await request(app)
      .get("/api/auth/me")
      .auth(login.body.accessToken, { type: "bearer" });
    expect(me.body).toEqual(login.body.user);
    const logout = await request(app)
      .post("/api/auth/logout")
      .auth(login.body.accessToken, { type: "bearer" });
    expect(logout.status).toBe(204);
    expect(
      (await request(app).get("/api/auth/me").auth(login.body.accessToken, { type: "bearer" }))
        .status,
    ).toBe(401);
    expect(
      (await db.query("SELECT * FROM sessions WHERE token_hash=$1", [row.token_hash])).rows,
    ).toEqual([]);
  });
  it("rejects expired tokens and missing account authentication", async () => {
    const login = await request(app).post("/api/auth/login").send(credentials);
    expect(login.status).toBe(200);
    await db.query(
      "UPDATE sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1",
      [hashToken(login.body.accessToken)],
    );
    expect(
      (await request(app).get("/api/auth/me").auth(login.body.accessToken, { type: "bearer" }))
        .status,
    ).toBe(401);
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).post("/api/auth/logout")).status).toBe(401);
  });
  it("returns the same failure for incorrect passwords and unknown usernames", async () => {
    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ ...credentials, password: "wrong" });
    const missing = await request(app)
      .post("/api/auth/login")
      .send({ username: "missing", password: "wrong" });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body).toEqual(missing.body);
    expect(wrong.body).toEqual({
      error: "Invalid username or password.",
      code: "INVALID_CREDENTIALS",
    });
  });
  it("validates login shape", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ username: "recorder", password: 1 });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });
  it("requires an explicit reset and revokes all old sessions on password reset", async () => {
    await expect(
      provisionAccount({
        username: "recorder",
        name: "Recorder",
        password: "replacement-password",
      }),
    ).rejects.toMatchObject({
      constructor: AuthError,
      failure: { reason: "username_already_exists", username: "recorder" },
    });
    const login = await request(app).post("/api/auth/login").send(credentials);
    expect(login.status).toBe(200);
    await provisionAccount(
      { username: "recorder", name: "Recorder", password: "replacement-password" },
      true,
    );
    expect(
      (await request(app).get("/api/auth/me").auth(login.body.accessToken, { type: "bearer" }))
        .status,
    ).toBe(401);
    const oldPassword = await request(app).post("/api/auth/login").send(credentials);
    expect(oldPassword.status).toBe(401);
    const replacement = await request(app)
      .post("/api/auth/login")
      .send({ ...credentials, password: "replacement-password" });
    expect(replacement.status).toBe(200);
  });
});
