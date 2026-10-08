import { tradesApi } from "@/store/api";
import { validDateRange } from "@/lib/trade-date-range";
import type { Trade } from "@/types/api";
import { useCallback, useState } from "react";
import PositionSummary from "@/components/PositionSummary";
import TradeTable, { defaultBlotterFilters } from "@/components/TradeTable";
import ExecutionPriceChart from "@/components/ExecutionPriceChart";
import ShareActivityChart from "@/components/ShareActivityChart";
import TradeDrawer from "@/components/TradeDrawer";
import { Button } from "@/components/ui/button";
import { useTrades } from "@/hooks/use-trades";
import { useAppDispatch, useAppSelector } from "@/store";
import { Monitor, MonitorCheck, RefreshCw } from "lucide-react";

export default function DashboardPage() {
  const trades = useTrades();
  const dispatch = useAppDispatch();
  const [filters, setFilters] = useState(defaultBlotterFilters);
  const [notice, setNotice] = useState("");
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [cancelTrade, cancellation] = tradesApi.useCancelTradeMutation();
  const rangeIsValid = validDateRange(filters);
  const openingIsFetching = useAppSelector(
    (state) => tradesApi.endpoints.getOpeningHoldings.select()(state).status === "pending",
  );
  const isRefreshing = trades.isFetching || openingIsFetching;
  function refreshDashboard() {
    void trades.refetch();
    dispatch(tradesApi.util.invalidateTags(["OpeningHoldings"]));
  }
  const connection = useAppSelector((state) => state.connection);

  const cancel = useCallback(
    async (tradeId: string) => {
      setNotice("");
      try {
        await cancelTrade(tradeId).unwrap();
        setNotice(`Trade ${tradeId} cancelled successfully.`);
      } catch {
        /* RTK Query exposes the error below. */
      }
    },
    [cancelTrade],
  );
  const resetCancellation = cancellation.reset;
  const editTrade = useCallback(
    (trade: Trade) => {
      resetCancellation();
      setEditingTrade(trade);
    },
    [resetCancellation],
  );

  const connectionIndicator =
    connection.status === "disabled"
      ? null
      : connection.status === "connected"
        ? {
            label: "Live updates",
            Icon: MonitorCheck,
            className: "text-emerald-700 dark:text-emerald-400",
            iconClassName: "animate-pulse motion-reduce:animate-none",
          }
        : connection.status === "connecting"
          ? {
              label: "Connecting to live updates…",
              Icon: Monitor,
              className: "text-muted-foreground",
              iconClassName: "",
            }
          : {
              label: "Reconnecting to live updates…",
              Icon: Monitor,
              className: "text-amber-700 dark:text-amber-400",
              iconClassName: "",
            };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>Trade activity</span>
            {connectionIndicator && (
              <span
                role="status"
                aria-live="polite"
                className={`inline-flex items-center gap-1.5 font-medium ${connectionIndicator.className}`}
              >
                <connectionIndicator.Icon
                  aria-hidden="true"
                  className={`size-4 ${connectionIndicator.iconClassName}`}
                />
                {connectionIndicator.label}
              </span>
            )}
          </p>
        </div>
        <div
          role="group"
          aria-label="Dashboard actions"
          className="flex flex-wrap items-center gap-2"
        >
          <Button variant="outline" size="sm" disabled={isRefreshing} onClick={refreshDashboard}>
            <RefreshCw
              aria-hidden="true"
              className={isRefreshing ? "animate-spin motion-reduce:animate-none" : undefined}
            />
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <TradeDrawer
            onCreated={(trade) => setNotice(`Trade ${trade.tradeId} recorded successfully.`)}
          />
        </div>
      </div>

      {notice && (
        <p role="status" className="border bg-muted p-3 text-sm">
          {notice}
        </p>
      )}
      {trades.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading trades…
        </p>
      )}
      {trades.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          <p>Could not load trades. {trades.error?.message}</p>
          <Button variant="outline" size="sm" onClick={() => void trades.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {cancellation.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not cancel trade. {(cancellation.error as { message?: string }).message}
        </p>
      )}
      {trades.data && (
        <PositionSummary
          trades={trades.data}
          selectedSymbol={filters.symbol}
          onSelectSymbol={(symbol) =>
            setFilters({
              ...defaultBlotterFilters,
              fromDate: filters.fromDate,
              toDate: filters.toDate,
              symbol,
            })
          }
        />
      )}
      <section
        aria-label="Chart and table date range"
        className="flex flex-wrap items-end gap-3 border border-border bg-card p-3"
      >
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          From
          <input
            type="date"
            value={filters.fromDate}
            max={filters.toDate || undefined}
            onChange={(event) => {
              setFilters({ ...filters, fromDate: event.target.value });
            }}
            className="h-10 border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          To
          <input
            type="date"
            value={filters.toDate}
            min={filters.fromDate || undefined}
            onChange={(event) => {
              setFilters({ ...filters, toDate: event.target.value });
            }}
            className="h-10 border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </label>

        {(filters.fromDate || filters.toDate) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilters({ ...filters, fromDate: "", toDate: "" })}
          >
            Clear dates
          </Button>
        )}
        <p className="pb-2 text-xs text-muted-foreground">
          Execution dates · UTC · applies to charts and trades
        </p>
      </section>

      {!rangeIsValid && (
        <p role="alert" className="text-sm text-destructive">
          From must be on or before To.
        </p>
      )}
      {trades.data && rangeIsValid && (
        <ExecutionPriceChart trades={trades.data} range={filters} selectedSymbol={filters.symbol} />
      )}
      {trades.data && rangeIsValid && (
        <ShareActivityChart trades={trades.data} range={filters} selectedSymbol={filters.symbol} />
      )}
      {trades.data && (
        <TradeTable
          filters={filters}
          onFiltersChange={setFilters}
          trades={rangeIsValid ? trades.data : []}
          onCancelTrade={cancel}
          onEditTrade={editTrade}
          isCancelling={cancellation.isLoading}
        />
      )}
      {editingTrade && (
        <TradeDrawer
          key={editingTrade.tradeId}
          trade={editingTrade}
          onClose={() => setEditingTrade(null)}
          onCreated={(trade) => setNotice(`Trade ${trade.tradeId} updated successfully.`)}
        />
      )}
    </section>
  );
}
