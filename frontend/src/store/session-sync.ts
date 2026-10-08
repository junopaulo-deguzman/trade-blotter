import { SESSION_KEY, parseSession } from "@/lib/session-storage";
import type { Session } from "@/types/auth";
import { tradesApi } from "./api";
import {
  sessionCleared,
  sessionReceived,
  sessionVerified,
  verificationFailed,
  persistenceFailed,
} from "./auth";
import type { AppStore } from "./index";

/** Storage contains only the server-issued session, never login credentials. */
export function startSessionSync(store: AppStore, providedStorage?: Storage) {
  let storage: Storage;
  try {
    storage = providedStorage ?? window.localStorage;
  } catch {
    store.dispatch(
      persistenceFailed(
        "Your browser could not access saved sessions. Check that browser storage is enabled.",
      ),
    );
    return () => {};
  }
  let disposed = false;
  let verification: { abort(): void; unsubscribe(): void } | undefined;
  let verifyingToken: string | undefined;
  let currentToken: string | undefined;
  let saved = "";
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let synchronizing = false;
  const persistenceFailure = () =>
    store.dispatch(
      persistenceFailed(
        "Your browser could not save the session. Check that browser storage is enabled.",
      ),
    );

  function verify(session: Session) {
    verification?.abort();
    verification?.unsubscribe();
    verifyingToken = session.accessToken;
    const token = session.accessToken;
    const query = store.dispatch(
      tradesApi.endpoints.verifySession.initiate(token, { subscribe: false, forceRefetch: true }),
    );
    verification = query;
    void query
      .unwrap()
      .then((user) => {
        if (disposed || verification !== query) return;
        verifyingToken = undefined;
        store.dispatch(sessionVerified({ token, user }));
      })
      .catch((error: { code?: string; message?: string }) => {
        if (
          disposed ||
          verification !== query ||
          store.getState().auth.session?.accessToken !== token
        )
          return;
        verifyingToken = undefined;
        if (error.code === "UNAUTHORIZED" || Date.parse(session.expiresAt) <= Date.now()) {
          store.dispatch(
            sessionCleared({ token, message: "Your session has expired. Please log in again." }),
          );
        } else {
          store.dispatch(
            verificationFailed({
              token,
              message: "Could not verify your session. Please try again.",
            }),
          );
        }
      });
  }

  function synchronize() {
    if (synchronizing) return;
    synchronizing = true;
    try {
      const auth = store.getState().auth;
      const serialized = auth.session ? JSON.stringify(auth.session) : "";
      if (serialized !== saved) {
        saved = serialized;
        try {
          if (serialized) {
            if (storage.getItem(SESSION_KEY) !== serialized)
              storage.setItem(SESSION_KEY, serialized);
          } else storage.removeItem(SESSION_KEY);
        } catch {
          persistenceFailure();
        }
      }
      const token = auth.session?.accessToken;
      if (token !== currentToken) {
        currentToken = token;
        clearTimeout(expiryTimer);
        verification?.abort();
        verification?.unsubscribe();
        verifyingToken = undefined;
        if (auth.session) {
          const session = auth.session;
          expiryTimer = setTimeout(
            () =>
              store.dispatch(
                sessionCleared({
                  token: session.accessToken,
                  message: "Your session has expired. Please log in again.",
                }),
              ),
            Math.max(0, Date.parse(session.expiresAt) - Date.now()),
          );
        }
      }
      if (auth.session && auth.status === "checking" && verifyingToken !== token)
        verify(auth.session);
      if (auth.status === "unavailable") verifyingToken = undefined;
    } finally {
      synchronizing = false;
    }
  }

  function restore() {
    try {
      const value = storage.getItem(SESSION_KEY);
      const session = parseSession(value);
      saved = value ?? "";
      if (session) store.dispatch(sessionReceived({ session, restored: true }));
      else {
        if (value) storage.removeItem(SESSION_KEY);
        saved = "";
        store.dispatch(sessionCleared(undefined));
      }
    } catch {
      persistenceFailure();
    }
  }
  const unsubscribe = store.subscribe(synchronize);
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== storage) return;
    if (event.key === SESSION_KEY || event.key === null) restore();
  };
  window.addEventListener("storage", onStorage);
  restore();
  return () => {
    disposed = true;
    unsubscribe();
    window.removeEventListener("storage", onStorage);
    clearTimeout(expiryTimer);
    verification?.abort();
    verification?.unsubscribe();
  };
}
