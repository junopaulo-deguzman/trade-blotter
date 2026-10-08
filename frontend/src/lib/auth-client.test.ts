import { expect, it, vi } from "vitest";
import { createAuthClient } from "./auth-client";
import { createApiTradesClient } from "./trades-client";

it("uses bearer authentication and accepts logout's empty 204 response", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1, username: "recorder", name: "Recorder" })),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const client = createAuthClient("/api");
  await client.me("token");
  await client.logout("token");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me");
  expect(fetchMock.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer token");
  expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/logout");
  expect(fetchMock.mock.calls[1][1].method).toBe("POST");
});

it("authenticates trade creation and invalidates only the token used by that request", async () => {
  let token = "first";
  const unauthorized = vi.fn();
  const fetchMock = vi.fn().mockImplementation(() => {
    token = "second";
    return Promise.resolve(
      new Response(JSON.stringify({ error: "Authentication required.", code: "UNAUTHORIZED" }), {
        status: 401,
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = createApiTradesClient("/api", {
    getAccessToken: () => token,
    onUnauthorized: unauthorized,
  });
  await expect(
    client.create({
      symbol: "AAPL",
      trader: "ABROWN",
      side: "BUY",
      quantity: 1,
      price: 10,
      book: "UK",
      counterparty: "Bank",
      tradeTimestamp: "2026-08-18T09:15:23Z",
    }),
  ).rejects.toThrow("Authentication required.");
  expect(fetchMock.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer first");
  expect(unauthorized).toHaveBeenCalledWith("first");
});
