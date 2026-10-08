import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/http-client";
import { SESSION_KEY } from "@/lib/session-storage";
import { createInMemoryTradesClient } from "@/test-utils/trades-client";
import type { AuthClient, Session, User } from "@/types/auth";
import { createAppStore } from "./index";
import { sessionCleared, sessionReceived } from "./auth";
import { tradesApi } from "./api";
import { startSessionSync } from "./session-sync";

const user = { id: 1, username: "recorder", name: "Trade Recorder" };
const session = (): Session => ({
  accessToken: "a".repeat(43),
  tokenType: "Bearer",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  user,
});
const cleanup: (() => void)[] = [];
function setup(auth: Partial<AuthClient> = {}) {
  const client: AuthClient = {
    login: vi.fn().mockResolvedValue(session()),
    me: vi.fn().mockResolvedValue(user),
    logout: vi.fn().mockResolvedValue(undefined),
    ...auth,
  };
  const store = createAppStore({
    client: createInMemoryTradesClient(),
    authClient: client,
  });
  const stop = startSessionSync(store);
  cleanup.push(() => {
    stop();
    store.dispatch(tradesApi.util.resetApiState());
  });
  return { store, client, stop };
}
function storageEvent() {
  window.dispatchEvent(
    new StorageEvent("storage", { key: SESSION_KEY, storageArea: localStorage }),
  );
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  localStorage.clear();
  vi.useRealTimers();
});

describe("persistent sessions", () => {
  it("saves the session and verifies it when a new app instance starts", async () => {
    const first = setup();
    const savedSession = await first.store
      .dispatch(
        tradesApi.endpoints.login.initiate({ username: "recorder", password: "secret-password" }),
      )
      .unwrap();
    first.store.dispatch(sessionReceived({ session: savedSession }));
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual(savedSession);
    expect(localStorage.getItem(SESSION_KEY)).not.toContain("secret-password");
    first.stop();
    const restored = setup();
    expect(restored.store.getState().auth.status).toBe("checking");
    await waitFor(() => expect(restored.store.getState().auth.status).toBe("authenticated"));
    expect(restored.client.me).toHaveBeenCalledWith(
      savedSession.accessToken,
      expect.any(AbortSignal),
    );
  });

  it("synchronizes login and logout with another tab", async () => {
    const first = setup();
    const second = setup();
    const savedSession = session();
    first.store.dispatch(sessionReceived({ session: savedSession }));
    storageEvent();
    await waitFor(() => expect(second.store.getState().auth.status).toBe("authenticated"));
    expect(second.store.getState().auth.session?.accessToken).toBe(savedSession.accessToken);
    first.store.dispatch(sessionCleared(undefined));
    storageEvent();
    expect(second.store.getState().auth.session).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("does not resurrect a session from an obsolete verification response", async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session()));
    let resolve!: (value: User) => void;
    const { store } = setup({
      me: () =>
        new Promise<User>((done) => {
          resolve = done;
        }),
    });
    store.dispatch(sessionCleared(undefined));
    resolve(user);
    await new Promise((done) => setTimeout(done, 0));
    expect(store.getState().auth.status).toBe("anonymous");
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("can verify the same session again after a subsequent storage event", async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session()));
    const { store, client } = setup();
    await waitFor(() => expect(store.getState().auth.status).toBe("authenticated"));
    storageEvent();
    await waitFor(() => expect(store.getState().auth.status).toBe("authenticated"));
    expect(client.me).toHaveBeenCalledTimes(2);
  });

  it("ignores an unauthorized response belonging to an older account", () => {
    const { store } = setup();
    store.dispatch(sessionReceived({ session: session() }));
    store.dispatch(sessionReceived({ session: { ...session(), accessToken: "b".repeat(43) } }));
    store.dispatch(sessionCleared({ token: "a".repeat(43) }));
    expect(store.getState().auth.session?.accessToken).toBe("b".repeat(43));
  });

  it("removes revoked sessions", async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session()));
    const { store } = setup({
      me: vi
        .fn()
        .mockRejectedValue(
          new ApiError({ status: 401, code: "UNAUTHORIZED", message: "Authentication required." }),
        ),
    });
    await waitFor(() => expect(store.getState().auth.status).toBe("anonymous"));
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("retains saved sessions during an outage and allows explicit verification retry", async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session()));
    const me = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValue(user);
    const { store } = setup({ me });
    await waitFor(() => expect(store.getState().auth.status).toBe("unavailable"));
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
    store.dispatch(sessionReceived({ session: store.getState().auth.session!, restored: true }));
    await waitFor(() => expect(store.getState().auth.status).toBe("authenticated"));
    expect(me).toHaveBeenCalledTimes(2);
  });

  it.each(["{broken", JSON.stringify({ ...session(), expiresAt: "2000-01-01T00:00:00Z" })])(
    "discards invalid or expired stored sessions: %s",
    (value) => {
      localStorage.setItem(SESSION_KEY, value);
      const { store, client } = setup();
      expect(store.getState().auth.status).toBe("anonymous");
      expect(client.me).not.toHaveBeenCalled();
      expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    },
  );

  it("clears active sessions when their expiry is reached", () => {
    vi.useFakeTimers();
    const { store } = setup();
    store.dispatch(
      sessionReceived({
        session: { ...session(), expiresAt: new Date(Date.now() + 1000).toISOString() },
      }),
    );
    vi.advanceTimersByTime(1001);
    expect(store.getState().auth.session).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("stops listening to storage events after cleanup", () => {
    const { store, stop } = setup();
    stop();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session()));
    storageEvent();
    expect(store.getState().auth.session).toBeNull();
  });
});
