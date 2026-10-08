import { useEffect, useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { createAppStore } from "@/store";
import { tradesApi } from "@/store/api";
import { startSessionSync } from "@/store/session-sync";
import type { TradesClient } from "@/types/api";
import type { AuthClient } from "@/types/auth";
import type { TradeUpdatesClient } from "@/store/services";

export function TradesProvider({
  children,
  client,
  authClient,
  updatesClient,
}: {
  children: ReactNode;
  client?: TradesClient;
  authClient?: AuthClient;
  updatesClient?: TradeUpdatesClient;
}) {
  const [store] = useState(() => createAppStore({ client, authClient, updatesClient }));
  useEffect(() => {
    const stopSessionSync = startSessionSync(store);
    // only initiate with authenticated clients
    if (!client || !authClient) return;
    const trades = store.dispatch(tradesApi.endpoints.getTrades.initiate());
    return () => {
      stopSessionSync();
      trades.unsubscribe();
      for (const read of store.dispatch(tradesApi.util.getRunningQueriesThunk())) read.abort();
      store.dispatch(tradesApi.util.resetApiState());
    };
  }, [store]);
  return <Provider store={store}>{children}</Provider>;
}
