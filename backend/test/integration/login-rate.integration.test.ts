import { expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.ts";

it("POST /auth/login limits repeated attempts", async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await request(app).post("/api/auth/login").send({});
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  }
  const limited = await request(app).post("/api/auth/login").send({});
  expect(limited.status).toBe(429);
  expect(limited.body).toEqual({
    error: "Too many login attempts. Try again later.",
    code: "RATE_LIMITED",
  });
});
