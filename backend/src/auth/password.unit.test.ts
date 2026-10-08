import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.ts";
describe("passwords", () => {
  it("uses independent salts and verifies only the correct password", async () => {
    const first = await hashPassword("test-password-123");
    const second = await hashPassword("test-password-123");
    expect(first).not.toBe(second);
    expect(first).not.toContain("test-password");
    expect(await verifyPassword("test-password-123", first)).toBe(true);
    expect(await verifyPassword("incorrect", first)).toBe(false);
  });
  it("rejects legacy/malformed hashes and unknown users", async () => {
    for (const value of ["plaintext", "scrypt-v1$bad$bad", null])
      expect(await verifyPassword("plaintext", value)).toBe(false);
  });
});
