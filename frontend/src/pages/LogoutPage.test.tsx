import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import LogoutPage from "./LogoutPage";
import { createAppStore } from "@/store";
import { startSessionSync } from "@/store/session-sync";
import { createInMemoryTradesClient } from "@/test-utils/trades-client";
import { SESSION_KEY } from "@/lib/session-storage";
import { tradesApi } from "@/store/api";
import { sessionReceived } from "@/store/auth";

const token = "a".repeat(43);
const session = {
  accessToken: token,
  tokenType: "Bearer" as const,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: { id: 1, username: "recorder", name: "Recorder" },
};
let cleanup: (() => void) | undefined;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup?.();
  localStorage.clear();
});

function setup(logout = vi.fn().mockResolvedValue(undefined)) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  const store = createAppStore({
    client: createInMemoryTradesClient(),
    authClient: { login: vi.fn(), logout, me: vi.fn().mockResolvedValue(session.user) },
  });
  const stop = startSessionSync(store);
  store.dispatch(sessionReceived({ session }));
  cleanup = () => {
    stop();
    store.dispatch(tradesApi.util.resetApiState());
  };
  render(
    <Provider store={store}>
      <LogoutPage />
    </Provider>,
  );
  return { logout };
}

it("clears the local session and revokes the server session on route visit", async () => {
  const { logout } = setup();

  expect(await screen.findByText("You have been logged out.")).toBeTruthy();
  expect(logout).toHaveBeenCalledWith(token);
  expect(localStorage.getItem(SESSION_KEY)).toBeNull();
});

it("offers a retry if server revocation fails after local logout", async () => {
  const user = userEvent.setup();
  const logout = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  setup(logout);

  expect(
    await screen.findByText(
      "You are logged out locally, but the server session could not be revoked.",
    ),
  ).toBeTruthy();
  expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry server logout" }));
  expect(await screen.findByText("You have been logged out.")).toBeTruthy();
  expect(logout).toHaveBeenNthCalledWith(2, token);
});
