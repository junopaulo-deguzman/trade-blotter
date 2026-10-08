import { useId, useMemo, useState } from "react";
import {
  emptyDateRange,
  executionDate,
  inDateRange,
  type TradeDateRange,
} from "@/lib/trade-date-range";
import type { Trade } from "@/types/api";

export function dailyShareActivity(
  trades: readonly Trade[],
  symbol: string | null,
  range: TradeDateRange,
) {
  const days = new Map<string, { date: string; bought: number; sold: number; count: number }>();
  for (const trade of trades) {
    if (
      trade.status !== "ACTIVE" ||
      (symbol && trade.symbol !== symbol) ||
      !inDateRange(trade, range)
    )
      continue;
    const date = executionDate(trade);
    const day = days.get(date) ?? { date, bought: 0, sold: 0, count: 0 };
    if (trade.side === "BUY") day.bought += trade.quantity;
    else day.sold += trade.quantity;
    day.count++;
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
const quantity = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact" });
const dateLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export default function ShareActivityChart({
  trades,
  selectedSymbol,
  range = emptyDateRange,
}: {
  trades: readonly Trade[];
  selectedSymbol: string | null;
  range?: TradeDateRange;
}) {
  const headingId = useId();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const model = useMemo(() => {
    const days = dailyShareActivity(trades, selectedSymbol, {
      fromDate: range.fromDate,
      toDate: range.toDate,
    });
    const max = Math.max(1, ...days.flatMap((day) => [day.bought, day.sold]));
    const first = Date.parse(days[0]?.date ?? "1970-01-01");
    const last = Date.parse(days.at(-1)?.date ?? "1970-01-01");
    const span = Math.max(1, (last - first) / 86400000);
    const width = Math.max(1, Math.min(24, 650 / (span + 1)));
    return {
      max,
      days: days.map((day) => ({
        ...day,
        x: first === last ? 485 : 85 + ((Date.parse(day.date) - first) / (last - first)) * 800,
        width,
        buyHeight: (day.bought / max) * 80,
        sellHeight: (day.sold / max) * 80,
        label: `${day.date}: Bought ${quantity.format(day.bought)}, sold ${quantity.format(day.sold)}, net ${quantity.format(day.bought - day.sold)} shares · ${day.count} executions`,
      })),
    };
  }, [trades, selectedSymbol, range.fromDate, range.toDate]);
  const selected = model.days.find((day) => day.date === selectedDate);
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden border border-border bg-card text-card-foreground"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div>
          <h2 id={headingId} className="font-heading text-base font-semibold">
            Daily share activity
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Active executions · shares bought and sold · UTC
          </p>
        </div>
        <span className="border border-border px-2 py-1 text-xs font-medium">
          {selectedSymbol ?? "All symbols"}
        </span>
      </div>
      {model.days.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          No active share activity to chart.
        </p>
      ) : (
        <>
          <ul aria-label="Share activity legend" className="flex gap-4 px-4 text-xs">
            <li className="flex items-center gap-1.5">
              <span className="size-2 bg-emerald-600" />
              Bought
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2 bg-orange-600" />
              Sold
            </li>
          </ul>
          <div className="overflow-x-auto px-2">
            <svg
              viewBox="0 0 940 240"
              role="group"
              aria-label="Daily shares bought and sold"
              className="w-full min-w-100"
              onPointerLeave={(event) => {
                if (!event.currentTarget.contains(document.activeElement)) setSelectedDate(null);
              }}
            >
              {[-1, 0, 1].map((tick) => (
                <g key={tick}>
                  <line
                    x1="70"
                    x2="900"
                    y1={120 - tick * 80}
                    y2={120 - tick * 80}
                    stroke="currentColor"
                    opacity={tick ? 0.08 : 0.3}
                  />
                  <text
                    x="58"
                    y={124 - tick * 80}
                    textAnchor="end"
                    fill="currentColor"
                    opacity="0.55"
                    fontSize="11"
                  >
                    {compact.format(tick * model.max)}
                  </text>
                </g>
              ))}
              {model.days.map((day, i) => (
                <g
                  key={day.date}
                  role="button"
                  aria-label={day.label}
                  tabIndex={selected ? (selectedDate === day.date ? 0 : -1) : i === 0 ? 0 : -1}
                  data-activity-index={i}
                  className="cursor-pointer focus:outline-2 focus:outline-current"
                  onPointerEnter={() => setSelectedDate(day.date)}
                  onFocus={() => setSelectedDate(day.date)}
                  onClick={() => setSelectedDate(day.date)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedDate(day.date);
                    }
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const next = Math.max(
                      0,
                      Math.min(model.days.length - 1, i + (event.key === "ArrowRight" ? 1 : -1)),
                    );
                    event.currentTarget.ownerSVGElement
                      ?.querySelector<SVGGElement>(`[data-activity-index="${next}"]`)
                      ?.focus();
                  }}
                >
                  <rect
                    x={day.x - day.width}
                    y="30"
                    width={day.width * 2}
                    height="180"
                    fill="transparent"
                  />
                  <rect
                    x={day.x - day.width / 2}
                    y={120 - day.buyHeight}
                    width={day.width}
                    height={day.buyHeight}
                    fill="#059669"
                    opacity={selectedDate === day.date ? 1 : 0.8}
                  />
                  <rect
                    x={day.x - day.width / 2}
                    y="120"
                    width={day.width}
                    height={day.sellHeight}
                    fill="#ea580c"
                    opacity={selectedDate === day.date ? 1 : 0.8}
                  />
                </g>
              ))}
              {model.days
                .filter((_, i) => i % Math.max(1, Math.ceil(model.days.length / 5)) === 0)
                .map((day) => (
                  <text
                    key={day.date}
                    x={day.x}
                    y="230"
                    textAnchor="middle"
                    fill="currentColor"
                    opacity="0.55"
                    fontSize="11"
                  >
                    {dateLabel.format(new Date(day.date))}
                  </text>
                ))}
            </svg>
          </div>
          <div className="border-t border-border px-4 py-3 text-xs">
            <p aria-live="polite" className="min-h-4 tabular-nums">
              {selected?.label ??
                "Hover a day, or focus the chart and use ← / → to inspect activity."}
            </p>
            <p className="mt-1 text-muted-foreground">
              Sells appear below zero for direction; quantities are positive. Net change is bought
              minus sold. Opening holdings are excluded. Days without executions have no bars.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
