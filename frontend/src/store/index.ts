import { createTradeUpdatesClient } from "@/lib/trade-updates-client";
import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import { createConfiguredTradesClient } from "@/lib/trades-client";
import { createAuthClient } from "@/lib/auth-client";
import type { AuthClient } from "@/types/auth";
import type { TradesClient } from "@/types/api";
import { authSlice, sessionCleared } from "./auth";
import { connectionSlice, tradesApi } from "./api";
import type { Services, TradeUpdatesClient } from "./services";

export function createAppStore(
  options: {
    client?: TradesClient;
    authClient?: AuthClient;
    updatesClient?: TradeUpdatesClient;
  } = {},
) {
  const http = {
    getAccessToken: (): string | null => store.getState().auth.session?.accessToken ?? null,
    onUnauthorized: (token: string) => {
      store.dispatch(
        sessionCleared({ token, message: "Your session has expired. Please log in again." }),
      );
    },
  };
  const services: Services = {
    trades: options.client ?? createConfiguredTradesClient(http),
    auth:
      options.authClient ??
      createAuthClient(import.meta.env.VITE_API_BASE_URL?.trim() || "/api", http),
    updates:
      options.updatesClient ??
      (options.client
        ? undefined
        : createTradeUpdatesClient(
            import.meta.env.VITE_API_BASE_URL?.trim() || "/api",
            http,
            (listener) => store.subscribe(listener),
          )),
    saveRevision: 0,
  };
  const store = configureStore({
    reducer: {
      auth: authSlice.reducer,
      connection: connectionSlice.reducer,
      [tradesApi.reducerPath]: tradesApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ thunk: { extraArgument: services } }).concat(tradesApi.middleware),
    devTools: false,
  });
  return store;
}

export type AppStore = ReturnType<typeof createAppStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export const useAppDispatch = useDispatch.withTypes<AppStore["dispatch"]>();
export const useAppSelector = useSelector.withTypes<RootState>();
