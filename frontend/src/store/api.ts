import { createApi, fakeBaseQuery, type BaseQueryApi } from "@reduxjs/toolkit/query/react";
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { OpeningHolding, Trade, TradeFormOptions, TradeInput } from "@/types/api";
import type { LoginInput, Session, User } from "@/types/auth";
import { requestError, type RequestError } from "@/lib/http-client";
import type { ConnectionStatus, Services } from "./services";
import type { Editor } from "@/types/ws";
import type { RootState } from "./index";

export const connectionSlice = createSlice({
  name: "connection",
  initialState: {
    status: "disabled" as ConnectionStatus | "disabled",
    editors: {} as Record<string, Editor[]>,
    connectionId: null as string | null,
    newTradeIds: [] as string[],
    pendingTradeIds: [] as string[],
    highlights: {} as Record<string, "created" | "amended">,
  },
  reducers: {
    connectionIdentified(state, action: PayloadAction<string>) {
      state.connectionId = action.payload;
    },
    presenceSnapshot(state, action: PayloadAction<Record<string, Editor[]>>) {
      state.editors = action.payload;
    },
    presenceChanged(state, action: PayloadAction<{ tradeId: string; editors: Editor[] }>) {
      if (action.payload.editors.length)
        state.editors[action.payload.tradeId] = action.payload.editors;
      else delete state.editors[action.payload.tradeId];
    },
    tradeAdded(state, action: PayloadAction<string>) {
      if (!state.newTradeIds.includes(action.payload)) {
        state.newTradeIds.push(action.payload);
        state.pendingTradeIds.push(action.payload);
      }
    },
    newTradesShown(state, action: PayloadAction<string[]>) {
      for (const id of state.pendingTradeIds) {
        if (action.payload.includes(id)) state.highlights[id] = "created";
      }
      state.pendingTradeIds = [];
    },
    highlightCleared(state, action: PayloadAction<string>) {
      delete state.highlights[action.payload];
    },
    tradeAmended(state, action: PayloadAction<string>) {
      if (!state.pendingTradeIds.includes(action.payload))
        state.highlights[action.payload] = "amended";
    },
    listRefreshed(state) {
      state.newTradeIds = [];
      state.pendingTradeIds = [];
      state.highlights = {};
    },
    statusChanged(state, action: PayloadAction<ConnectionStatus | "disabled">) {
      state.status = action.payload;
      if (action.payload !== "connected") {
        state.editors = {};
        state.connectionId = null;
      }
    },
  },
});

function cacheTrade(
  { dispatch, getState }: Pick<BaseQueryApi, "dispatch" | "getState">,
  services: Services,
  trade: Trade,
  action: "created" | "amended" | "cancelled",
) {
  const exists = tradesApi.endpoints.getTrades
    .select()(getState() as RootState)
    .data?.some((item) => item.tradeId === trade.tradeId);
  services.saveRevision++;
  dispatch(
    tradesApi.util.updateQueryData("getTrades", undefined, (trades) => {
      const index = trades.findIndex((item) => item.tradeId === trade.tradeId);
      if (index >= 0) trades[index] = trade;
      else if (action === "created") trades.unshift(trade);
    }),
  );
  if (action === "created" && !exists) dispatch(connectionSlice.actions.tradeAdded(trade.tradeId));
  if (action === "amended") dispatch(connectionSlice.actions.tradeAmended(trade.tradeId));
  if (action === "cancelled") dispatch(connectionSlice.actions.highlightCleared(trade.tradeId));
}

export const tradesApi = createApi({
  reducerPath: "tradesApi",
  baseQuery: fakeBaseQuery<RequestError>(),
  tagTypes: ["TradeList", "OpeningHoldings"],
  invalidationBehavior: "delayed",
  endpoints: (build) => ({
    getTrades: build.query<Trade[], void>({
      async queryFn(_arg, api): Promise<{ data: Trade[] } | { error: RequestError }> {
        const services = api.extra as Services;
        const revision = services.saveRevision;
        try {
          const data = await services.trades.list(api.signal);
          // A read started before a confirmed write cannot erase that write.
          const current = tradesApi.endpoints.getTrades.select()(api.getState() as RootState).data;
          if (revision !== services.saveRevision && current) {
            // A confirmed change during this read needs a fresh snapshot after it finishes.
            setTimeout(() => api.dispatch(tradesApi.util.invalidateTags(["TradeList"])), 0);
            return { data: current };
          }
          api.dispatch(connectionSlice.actions.listRefreshed());
          return { data };
        } catch (error) {
          return { error: requestError(error) };
        }
      },
      providesTags: ["TradeList"],
      async onCacheEntryAdded(
        _arg,
        { extra, dispatch, getState, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const services = extra as Services;
        if (!services.updates) return;
        let active = true;
        // Serialize events so a cancellation cannot be overwritten by an earlier creation read.
        let pending = Promise.resolve();
        let previous: ConnectionStatus = "connecting";
        let hasConnected = false;
        const unsubscribe = services.updates.subscribe({
          onReady: (connectionId) =>
            dispatch(connectionSlice.actions.connectionIdentified(connectionId)),
          onPresence: (event) => {
            if (!active) return;
            if (event.type === "editing.snapshot")
              dispatch(
                connectionSlice.actions.presenceSnapshot(
                  Object.fromEntries(event.trades.map((trade) => [trade.tradeId, trade.editors])),
                ),
              );
            else dispatch(connectionSlice.actions.presenceChanged(event));
          },
          onChange: (event) => {
            if (!active) return;
            pending = pending
              .then(async () => {
                await cacheDataLoaded;
                if (!active) return;
                const request = dispatch(
                  tradesApi.endpoints.getTradeById.initiate(event.tradeId, {
                    subscribe: false,
                    forceRefetch: true,
                  }),
                );
                const trade = await request.unwrap();
                if (!active) return;
                cacheTrade({ dispatch, getState }, services, trade, event.action);
              })
              .catch(() => {});
          },
          onStatus: (status) => {
            if (!active) return;
            dispatch(connectionSlice.actions.statusChanged(status));
            if (status === "connected" && previous !== "connected") {
              const query = tradesApi.endpoints.getTrades.select()(getState() as RootState);
              // The initial load already supplies the startup snapshot. Do not queue
              // another full pagination run behind it. Reconnects still recover gaps,
              // as does a first connection arriving after the initial read completed.
              if (hasConnected || query.status !== "pending")
                dispatch(tradesApi.util.invalidateTags(["TradeList"]));
              hasConnected = true;
            }
            previous = status;
          },
        });
        await cacheEntryRemoved;
        active = false;
        unsubscribe();
      },
    }),
    getOpeningHoldings: build.query<OpeningHolding[], void>({
      async queryFn(_arg, api) {
        try {
          return { data: await (api.extra as Services).trades.openingHoldings(api.signal) };
        } catch (error) {
          return { error: requestError(error) };
        }
      },
      providesTags: ["OpeningHoldings"],
    }),
    getTradeById: build.query<Trade, string>({
      async queryFn(tradeId, api) {
        try {
          return { data: await (api.extra as Services).trades.getTradeById(tradeId, api.signal) };
        } catch (error) {
          return { error: requestError(error) };
        }
      },
    }),
    getTradeOptions: build.query<TradeFormOptions, void>({
      async queryFn(_arg, api) {
        try {
          return { data: await (api.extra as Services).trades.options(api.signal) };
        } catch (error) {
          return { error: requestError(error) };
        }
      },
    }),
    createTrade: build.mutation<Trade, TradeInput>({
      async queryFn(input, api) {
        const services = api.extra as Services;
        try {
          const trade = await services.trades.create(input);
          const current = tradesApi.endpoints.getTrades.select()(api.getState() as RootState).data;
          if (!current) {
            // Seed even when the initial list has not loaded. Abort that obsolete read first.
            api.dispatch(tradesApi.util.getRunningQueryThunk("getTrades", undefined))?.abort();
            api.dispatch(
              tradesApi.util.upsertQueryEntries([
                { endpointName: "getTrades", arg: undefined, value: [trade] },
              ]),
            );
          }
          if (!current) api.dispatch(connectionSlice.actions.tradeAdded(trade.tradeId));
          cacheTrade(api, services, trade, "created");
          return { data: trade };
        } catch (error) {
          return { error: requestError(error) };
        }
      },
    }),
    cancelTrade: build.mutation<Trade, string>({
      async queryFn(tradeId, api) {
        const services = api.extra as Services;
        try {
          const trade = await services.trades.cancel(tradeId);
          cacheTrade(api, services, trade, "cancelled");
          return { data: trade };
        } catch (error) {
          return { error: requestError(error) };
        }
      },
    }),
    amendTrade: build.mutation<Trade, { tradeId: string; input: TradeInput }>({
      async queryFn({ tradeId, input }, api) {
        const services = api.extra as Services;
        try {
          const trade = await services.trades.amend(tradeId, input);
          cacheTrade(api, services, trade, "amended");
          return { data: trade };
        } catch (error) {
          return { error: requestError(error) };
        }
      },
    }),
    login: build.mutation<Session, LoginInput>({
      async queryFn(input, api) {
        try {
          return { data: await (api.extra as Services).auth.login(input) };
        } catch (error) {
          return { error: requestError(error) };
        }
      },
    }),
    verifySession: build.query<User, string>({
      async queryFn(token, api) {
        try {
          return { data: await (api.extra as Services).auth.me(token, api.signal) };
        } catch (error) {
          return { error: requestError(error) };
        }
      },
      keepUnusedDataFor: 0,
    }),
    logout: build.mutation<void, string>({
      async queryFn(token, api) {
        try {
          await (api.extra as Services).auth.logout(token);
          return { data: undefined };
        } catch (error) {
          return { error: requestError(error) };
        }
      },
    }),
  }),
});

export const setEditingTrade =
  (tradeId: string | null) => (_dispatch: unknown, _getState: unknown, services: Services) =>
    services.updates?.setEditingTrade?.(tradeId);
