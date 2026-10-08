import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Trade } from "@/types/api";
import { tradesApi } from "@/store/api";
import { summarizeSymbols } from "@/lib/position-summary";
import { weightedExecutionPrices, formatPrice, formatValue } from "@/lib/execution-prices";
import { Button } from "@/components/ui/button";

const quantityFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
function formatQuantity(quantity: number, signed = false) {
  const value = quantityFormat.format(Math.abs(quantity));
  return quantity < 0 ? `−${value}` : signed && quantity > 0 ? `+${value}` : value;
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export default function PositionSummary({
  trades,
  selectedSymbol,
  onSelectSymbol,
}: {
  trades: readonly Trade[];
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const headingId = useId();
  const opening = tradesApi.useGetOpeningHoldingsQuery();
  const positions = useMemo(
    () => summarizeSymbols(trades, opening.data ?? []),
    [trades, opening.data],
  );
  const prices = useMemo(() => weightedExecutionPrices(trades), [trades]);
  const previous = useRef<Map<string, number> | null>(null);
  const [changes, setChanges] = useState<Record<string, number>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (!opening.data) return;
    const current = new Map(
      positions.map((position) => [position.symbol, position.currentQuantity]),
    );
    if (previous.current) {
      const deltas: Record<string, number> = {};
      for (const [symbol, quantity] of current) {
        const delta = quantity - (previous.current.get(symbol) ?? 0);
        if (!delta) continue;
        deltas[symbol] = delta;
        clearTimeout(timers.current.get(symbol));
        timers.current.set(
          symbol,
          setTimeout(() => {
            setChanges((values) => {
              const next = { ...values };
              delete next[symbol];
              return next;
            });
            timers.current.delete(symbol);
          }, 4000),
        );
      }
      if (Object.keys(deltas).length) setChanges((values) => ({ ...values, ...deltas }));
    }
    previous.current = current;
  }, [positions, opening.data]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-60 flex-1">
          <h2 id={headingId} className="font-heading text-base font-semibold">
            Position summary
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Positions across all books and dates. Active trades only; date and table filters do not
            affect these totals. Select a symbol to filter the chart and trades.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant={selectedSymbol ? "outline" : "secondary"}
            size="sm"
            aria-pressed={!selectedSymbol}
            onClick={() => onSelectSymbol(null)}
          >
            All symbols
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={expanded ? "Collapse position summary" : "Expand position summary"}
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown aria-hidden="true" className={expanded ? "rotate-180" : undefined} />
          </Button>
        </div>
      </div>
      <div id={contentId} hidden={!expanded}>
        {opening.isLoading && (
          <p className="text-sm text-muted-foreground">Loading opening holdings…</p>
        )}
        {opening.isError && (
          <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            <p>Could not load opening holdings.</p>
            <Button variant="outline" size="sm" onClick={() => void opening.refetch()}>
              Retry opening holdings
            </Button>
          </div>
        )}
        {opening.data &&
          (positions.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {positions.map((position) => {
                const reference = prices.get(position.symbol);
                const value = reference ? position.currentQuantity * reference.price : null;
                return (
                  <article
                    key={position.symbol}
                    aria-label={`${position.symbol} position`}
                    className={`relative border bg-card p-3 text-card-foreground transition-colors motion-reduce:transition-none ${selectedSymbol === position.symbol ? "border-primary ring-1 ring-primary" : "border-border"} ${changes[position.symbol] ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-heading text-base font-semibold">
                        <button
                          type="button"
                          aria-label={`Filter by ${position.symbol}`}
                          aria-pressed={selectedSymbol === position.symbol}
                          className="cursor-pointer text-left outline-none after:absolute after:inset-0 hover:underline focus-visible:after:ring-2 focus-visible:after:ring-ring"
                          onClick={() =>
                            onSelectSymbol(
                              selectedSymbol === position.symbol ? null : position.symbol,
                            )
                          }
                        >
                          {position.symbol}
                        </button>
                      </h3>
                      {changes[position.symbol] && (
                        <span role="status" className="text-xs font-medium tabular-nums">
                          {formatQuantity(changes[position.symbol], true)} shares
                        </span>
                      )}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <dt className="text-xs text-muted-foreground">Current position</dt>
                        <dd className="mt-0.5 text-xl font-semibold tabular-nums">
                          {formatQuantity(position.currentQuantity)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Estimated value</dt>
                        <dd
                          className="mt-0.5 text-xl font-semibold tabular-nums"
                          title={value === null ? undefined : formatPrice.format(value)}
                        >
                          {value === null ? "Unavailable" : formatValue.format(value)}
                        </dd>
                      </div>
                    </dl>
                    <dl className="mt-2 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Weighted avg price</dt>
                        <dd className="font-medium tabular-nums">
                          {reference ? formatPrice.format(reference.price) : "Unavailable"}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {reference
                        ? `${reference.tradeCount} executions · ${formatQuantity(reference.quantity)} shares`
                        : "No active executions to average"}
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 text-sm">
                      <Metric
                        label="Opening quantity"
                        value={formatQuantity(position.openingQuantity)}
                      />
                      <Metric
                        label="Net traded"
                        value={formatQuantity(position.netQuantity, true)}
                      />
                      <Metric label="Bought" value={formatQuantity(position.boughtQuantity)} />
                      <Metric label="Sold" value={formatQuantity(position.soldQuantity)} />
                    </dl>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No holdings or active trades to summarize.
            </p>
          ))}
        {opening.data && positions.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Estimated value = current position × quantity-weighted average price of all active buys
            and sells. This is a USD valuation proxy, not market value, acquisition cost, or
            P&amp;L.
          </p>
        )}
      </div>
    </section>
  );
}
