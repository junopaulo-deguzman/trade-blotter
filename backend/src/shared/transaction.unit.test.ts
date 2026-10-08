import { beforeEach, describe, expect, it, vi } from "vitest";
import { transaction } from "./transaction.ts";

const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));

vi.mock("../../db/connection.ts", () => ({ db: { connect: vi.fn(async () => client) } }));
beforeEach(() => vi.resetAllMocks());

describe("transaction lifecycle", () => {
  it("commits and releases on success", async () => {
    await expect(transaction(async () => 42)).resolves.toBe(42);
    expect(client.query.mock.calls.map((call) => call[0])).toEqual(["BEGIN", "COMMIT"]);
    expect(client.release).toHaveBeenCalledOnce();
  });
  it("rolls back and releases on failure", async () => {
    const error = new Error("work failed");
    await expect(
      transaction(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(client.query.mock.calls.map((call) => call[0])).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledOnce();
  });
  it("uses a consistent read-only snapshot for pagination", async () => {
    await transaction(async () => undefined, true);
    expect(client.query).toHaveBeenCalledWith("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  });
});
