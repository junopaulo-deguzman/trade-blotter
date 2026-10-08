import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import LoginPage from "./LoginPage";
import { createAppStore } from "@/store";
import { startSessionSync } from "@/store/session-sync";
import { createInMemoryTradesClient } from "@/test-utils/trades-client";
import { SESSION_KEY } from "@/lib/session-storage";
import { ApiError } from "@/lib/http-client";
import { tradesApi } from "@/store/api";

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

function setup(login = vi.fn().mockResolvedValue(session), restoreSession = false) {
  const logout = vi.fn().mockResolvedValue(undefined);
  if (restoreSession) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  const store = createAppStore({
    client: createInMemoryTradesClient(),
    authClient: { login, logout, me: vi.fn().mockResolvedValue(session.user) },
  });
  const stop = startSessionSync(store);
  cleanup = () => {
    stop();
    store.dispatch(tradesApi.util.resetApiState());
  };
  function CurrentPath() {
    return <output data-testid="current-path">{useLocation().pathname}</output>;
  }
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<p>Dashboard route</p>} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </Provider>,
  );
  return { store, login, logout };
}

it("logs in, persists the session, and redirects to the dashboard", async () => {
  const user = userEvent.setup();
  const { login } = setup();
  await user.type(screen.getByLabelText("Username"), "recorder");
  await user.type(screen.getByLabelText("Password"), "secret-password");
  await user.click(screen.getByRole("button", { name: "Log in" }));
  expect(await screen.findByText("Dashboard route")).toBeTruthy();
  expect(screen.getByTestId("current-path").textContent).toBe("/dashboard");
  expect(login).toHaveBeenCalledWith({ username: "recorder", password: "secret-password" });
  expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual(session);
});

it("redirects to the dashboard after a saved session is verified", async () => {
  setup(vi.fn(), true);

  expect(await screen.findByText("Dashboard route")).toBeTruthy();
  expect(screen.getByTestId("current-path").textContent).toBe("/dashboard");
});

it("shows invalid credentials without persisting authentication", async () => {
  const user = userEvent.setup();
  setup(
    vi.fn().mockRejectedValue(
      new ApiError({
        status: 401,
        code: "INVALID_CREDENTIALS",
        message: "Invalid username or password.",
      }),
    ),
  );
  await user.type(screen.getByLabelText("Username"), "recorder");
  await user.type(screen.getByLabelText("Password"), "wrong");
  await user.click(screen.getByRole("button", { name: "Log in" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Invalid username or password.",
  );
  expect(localStorage.getItem(SESSION_KEY)).toBeNull();
});
