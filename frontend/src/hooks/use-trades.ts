import { tradesApi } from "@/store/api";
import type { TradeInput } from "@/types/api";
import type { RequestError } from "@/lib/http-client";

const errorDetail = (error: unknown): RequestError | undefined =>
  error ? (error as RequestError) : undefined;

export function useTrades() {
  const query = tradesApi.useGetTradesQuery();
  return { ...query, isPending: query.isLoading, error: errorDetail(query.error) };
}

export function useTradeOptions(open: boolean) {
  const query = tradesApi.useGetTradeOptionsQuery(undefined, {
    skip: !open,
    refetchOnMountOrArgChange: true,
  });
  return {
    ...query,
    isPending: open && (query.isUninitialized || query.isFetching),
    error: errorDetail(query.error),
  };
}

export function useCreateTrade() {
  const [createTrade, mutation] = tradesApi.useCreateTradeMutation();
  return {
    ...mutation,
    isPending: mutation.isLoading,
    error: errorDetail(mutation.error),
    save: (input: Parameters<typeof createTrade>[0]) => createTrade(input).unwrap(),
  };
}

export function useAmendTrade(tradeId: string) {
  const [amendTrade, mutation] = tradesApi.useAmendTradeMutation();
  return {
    ...mutation,
    isPending: mutation.isLoading,
    error: errorDetail(mutation.error),
    save: (input: TradeInput) => amendTrade({ tradeId, input }).unwrap(),
  };
}
