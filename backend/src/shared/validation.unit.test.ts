import { describe, expect, it } from "vitest";
import { tradeInputSchema, tradeListSchema, tradeIdSchema } from "../trades/trades.types.ts";
import { InputValidationError, validate } from "./validation.ts";
const input = {
  symbol: " aapl ",
  trader: " abrown ",
  quantity: 1,
  price: 1.25,
  side: "BUY",
  book: " UK ",
  counterparty: " Bank ",
  tradeTimestamp: "2026-08-18T09:15:23Z",
};
describe("request validation", () => {
  it("normalizes codes and trims labels", () => {
    expect(validate(tradeInputSchema, input)).toMatchObject({
      symbol: "AAPL",
      trader: "ABROWN",
      book: "UK",
      counterparty: "Bank",
    });
  });
  it("retains field details without HTTP statuses or API codes", () => {
    try {
      validate(tradeInputSchema, { ...input, quantity: 0, price: -1 });
      expect.fail("Expected invalid input to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(InputValidationError);
      expect(error).toMatchObject({
        fieldErrors: { quantity: [expect.any(String)], price: [expect.any(String)] },
      });
      expect(error).not.toHaveProperty("status");
      expect(error).not.toHaveProperty("code");
    }
  });
  it.each([
    ["quantity", 0],
    ["quantity", 1.5],
    ["quantity", 2147483648],
    ["quantity", "2"],
    ["price", -1],
    ["price", Infinity],
    ["price", NaN],
    ["price", "1.5"],
    ["side", "HOLD"],
    ["book", " "],
    ["symbol", ""],
    ["tradeTimestamp", "2026-02-30T00:00:00Z"],
    ["tradeTimestamp", "2026-01-01T00:00:00+01:00"],
    ["tradeTimestamp", "not-a-date"],
    ["tradeTimestamp", "0000-01-01T00:00:00Z"],
  ])("rejects invalid %s: %s", (field, value) => {
    expect(() => validate(tradeInputSchema, { ...input, [field]: value })).toThrow(
      InputValidationError,
    );
  });
  it.each(["status", "recordedById", "symbolId", "traderId"])(
    "rejects server-controlled field %s",
    (field) => {
      expect(() => validate(tradeInputSchema, { ...input, [field]: 1 })).toThrow();
    },
  );
  it("rejects nonobject requests and missing fields", () => {
    for (const value of [null, [], undefined, {}])
      expect(() => validate(tradeInputSchema, value)).toThrow();
  });
  it("defaults pagination and validates integer query strings", () => {
    expect(validate(tradeListSchema, {})).toEqual({ limit: 100, offset: 0 });
    expect(validate(tradeListSchema, { limit: "2", offset: "10" })).toEqual({
      limit: 2,
      offset: 10,
    });
    for (const query of [
      { limit: "0" },
      { limit: "101" },
      { limit: "2.5" },
      { limit: ["1", "2"] },
      { offset: "-1" },
      { offset: "1e2" },
      { offset: "9007199254740992" },
    ])
      expect(() => validate(tradeListSchema, query)).toThrow();
  });
  it("accepts formatted and numeric IDs but rejects invalid IDs", () => {
    expect(validate(tradeIdSchema, "TD-00042")).toBe(42);
    expect(validate(tradeIdSchema, "42")).toBe(42);
    for (const value of ["0", "-1", "1.1", "TD-no", "2147483648"])
      expect(() => validate(tradeIdSchema, value)).toThrow();
  });
});
