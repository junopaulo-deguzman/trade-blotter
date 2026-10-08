import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { emptyDateRange, inDateRange, type TradeDateRange } from "@/lib/trade-date-range";
import type { Trade } from "@/types/api";
import {
  dailyExecutionPrices,
  formatPrice,
  symbolColours,
  type DailyExecutionPrice,
} from "@/lib/execution-prices";

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
function niceStep(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * magnitude;
}

/** Geometry and formatted labels depend on data, never on the pointer. */
function chartModel(points: DailyExecutionPrice[], colours: Map<string, string>) {
  const times = points.map((point) => Date.parse(point.date));
  const prices = points.map((point) => point.price);
  const minTime = Math.min(...times),
    maxTime = Math.max(...times);
  const minPrice = Math.min(...prices),
    maxPrice = Math.max(...prices);
  const step = points.length
    ? niceStep(Math.max(maxPrice - minPrice, maxPrice * 0.02, 0.01) / 4)
    : 1;
  const low = Math.max(0, Math.floor((minPrice - step * 0.1) / step) * step);
  const high = Math.ceil((maxPrice + step * 0.1) / step) * step;
  const x = (time: number) =>
    maxTime === minTime ? 485 : 70 + ((time - minTime) / (maxTime - minTime)) * 830;
  const y = (price: number) => 200 - ((price - low) / (high - low)) * 175;
  const plotted = points.map((point) => ({
    ...point,
    x: x(Date.parse(point.date)),
    y: y(point.price),
    colour: colours.get(point.symbol),
    label: `${point.symbol} ${formatPrice.format(point.price)} weighted average on ${point.date}, ${point.tradeCount} executions`,
    detail: `${point.symbol} · ${point.date} · ${formatPrice.format(point.price)} weighted average · ${point.tradeCount} executions · ${point.quantity.toLocaleString("en-US")} shares`,
  }));
  const symbols = [...new Set(points.map((point) => point.symbol))].sort();
  const series = symbols.map((symbol) => {
    const values = plotted.filter((point) => point.symbol === symbol);
    const path = values.map((point, i) => `${i ? "L" : "M"}${point.x},${point.y}`).join(" ");
    const first = values[0],
      last = values[values.length - 1];
    return {
      symbol,
      colour: colours.get(symbol),
      path,
      area: values.length > 1 ? `${path} L${last.x},200 L${first.x},200 Z` : null,
      last,
    };
  });
  const ticks = points.length
    ? Array.from({ length: Math.round((high - low) / step) + 1 }, (_, i) => {
        const price = low + i * step;
        return { price, y: y(price), label: formatPrice.format(price) };
      })
    : [];
  const dateTicks = points.length
    ? [
        ...new Set(
          Array.from(
            { length: maxTime === minTime ? 1 : 5 },
            (_, i) => Math.floor((minTime + ((maxTime - minTime) * i) / 4) / 86400000) * 86400000,
          ),
        ),
      ].map((time) => ({ time, x: x(time), label: dayLabel.format(new Date(time)) }))
    : [];
  return { points: plotted, series, ticks, dateTicks };
}
type ChartModel = ReturnType<typeof chartModel>;

const StaticPlot = memo(function StaticPlot({
  model,
  gradientId,
  focusedId,
  onSelect,
}: {
  model: ChartModel;
  gradientId: string;
  focusedId: string | null;
  onSelect: (id: string) => void;
}) {
  const hasFocusedPoint = model.points.some((point) => point.id === focusedId);
  return (
    <g>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={model.series[0]?.colour} stopOpacity="0.15" />
          <stop offset="100%" stopColor={model.series[0]?.colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      {model.ticks.map((tick) => (
        <g key={tick.price}>
          <line
            x1="70"
            x2="900"
            y1={tick.y}
            y2={tick.y}
            stroke="currentColor"
            opacity="0.08"
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
          />
          <text
            x="58"
            y={tick.y + 4}
            textAnchor="end"
            fill="currentColor"
            opacity="0.55"
            fontSize="11"
          >
            {tick.label}
          </text>
        </g>
      ))}
      {model.dateTicks.map((tick) => (
        <text
          key={tick.time}
          x={tick.x}
          y="227"
          textAnchor="middle"
          fill="currentColor"
          opacity="0.55"
          fontSize="11"
        >
          {tick.label}
        </text>
      ))}
      {model.series.map((series) => (
        <g key={series.symbol}>
          {model.series.length === 1 && series.area && (
            <path d={series.area} fill={`url(#${gradientId})`} />
          )}
          <path
            d={series.path}
            fill="none"
            stroke={series.colour}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={series.last.x} cy={series.last.y} r="3" fill={series.colour} />
        </g>
      ))}
      {model.points.map((point, index) => (
        <circle
          key={point.id}
          cx={point.x}
          cy={point.y}
          r="8"
          fill="transparent"
          role="button"
          aria-label={point.label}
          tabIndex={hasFocusedPoint ? (focusedId === point.id ? 0 : -1) : index === 0 ? 0 : -1}
          data-point-index={index}
          className="cursor-pointer focus:outline-2 focus:outline-offset-2 focus:outline-current"
          onFocus={() => onSelect(point.id)}
          onClick={() => onSelect(point.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(point.id);
            }
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = Math.max(
              0,
              Math.min(model.points.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)),
            );
            event.currentTarget.ownerSVGElement
              ?.querySelector<SVGCircleElement>(`[data-point-index="${next}"]`)
              ?.focus();
          }}
        />
      ))}
    </g>
  );
});

function InteractivePlot({ model }: { model: ChartModel }) {
  const gradientId = useId();
  const [pointId, setPointId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const pendingFrame = useRef<number | null>(null);
  const pointer = useRef<{ clientX: number; clientY: number; svg: SVGSVGElement } | null>(null);
  const selected = model.points.find((point) => point.id === pointId);
  const cancelFrame = useCallback(() => {
    if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
    pendingFrame.current = null;
    pointer.current = null;
  }, []);
  const selectFocused = useCallback(
    (id: string) => {
      cancelFrame();
      setFocusedId(id);
      setPointId(id);
    },
    [cancelFrame],
  );
  const latestPoints = useRef(model.points);
  useEffect(() => {
    latestPoints.current = model.points;
    return cancelFrame;
  }, [cancelFrame, model.points]);

  return (
    <>
      <div className="mt-2 overflow-x-auto px-2">
        <svg
          viewBox="0 0 940 240"
          role="group"
          aria-label="Execution prices in USD over time"
          className="w-full min-w-100"
          onPointerMove={(event) => {
            pointer.current = {
              clientX: event.clientX,
              clientY: event.clientY,
              svg: event.currentTarget,
            };
            if (pendingFrame.current !== null) return;
            pendingFrame.current = requestAnimationFrame(() => {
              pendingFrame.current = null;
              const position = pointer.current;
              if (!position) return;
              const bounds = position.svg.getBoundingClientRect();
              if (!bounds.width || !bounds.height) return;
              const x = ((position.clientX - bounds.left) / bounds.width) * 940;
              const y = ((position.clientY - bounds.top) / bounds.height) * 240;
              if (x < 70 || x > 900 || y < 25 || y > 200) {
                setPointId(null);
                return;
              }
              let closest = latestPoints.current[0];
              for (const point of latestPoints.current) {
                const dx = Math.abs(point.x - x),
                  bestDx = Math.abs(closest.x - x);
                if (
                  dx < bestDx ||
                  (dx === bestDx && Math.abs(point.y - y) < Math.abs(closest.y - y))
                )
                  closest = point;
              }
              setPointId((current) => (current === closest.id ? current : closest.id));
            });
          }}
          onPointerLeave={(event) => {
            cancelFrame();
            if (!event.currentTarget.contains(document.activeElement)) setPointId(null);
          }}
        >
          <StaticPlot
            model={model}
            gradientId={gradientId}
            focusedId={focusedId}
            onSelect={selectFocused}
          />
          {selected && (
            <g pointerEvents="none">
              <line
                x1={selected.x}
                x2={selected.x}
                y1="25"
                y2="200"
                stroke="currentColor"
                opacity="0.25"
                strokeDasharray="3 4"
              />
              <circle
                cx={selected.x}
                cy={selected.y}
                r="4"
                fill={selected.colour}
                stroke="var(--color-card)"
                strokeWidth="1.5"
              />
            </g>
          )}
        </svg>
      </div>
      <div className="border-t border-border px-4 py-3 text-xs">
        <p className="min-h-4 tabular-nums" aria-live="polite">
          {selected?.detail ??
            "Move across the chart, or focus it and use ← / → to inspect daily executions."}
        </p>
        <p className="mt-1 text-muted-foreground">
          Recorded executions, not external market quotes. Days without trades are connected; no
          prices are invented.
        </p>
      </div>
    </>
  );
}

export default function ExecutionPriceChart({
  trades,
  selectedSymbol,
  range = emptyDateRange,
}: {
  trades: readonly Trade[];
  selectedSymbol: string | null;
  range?: TradeDateRange;
}) {
  const headingId = useId();
  const points = useMemo(
    () =>
      dailyExecutionPrices(
        trades.filter((trade) =>
          inDateRange(trade, { fromDate: range.fromDate, toDate: range.toDate }),
        ),
        selectedSymbol,
      ),
    [trades, selectedSymbol, range.fromDate, range.toDate],
  );
  const colours = useMemo(() => symbolColours(trades), [trades]);
  const model = useMemo(() => chartModel(points, colours), [points, colours]);
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden border border-border bg-card text-card-foreground"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div>
          <h2 id={headingId} className="font-heading text-base font-semibold">
            Execution price history
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Daily quantity-weighted averages of active executions · USD · UTC
          </p>
        </div>
        <span className="border border-border px-2 py-1 text-xs font-medium">
          {selectedSymbol ?? "All symbols"}
        </span>
      </div>
      {points.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No active executions to chart.</p>
      ) : (
        <>
          <ul
            aria-label="Price chart legend"
            className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-4 text-xs"
          >
            {model.series.map((series) => (
              <li key={series.symbol} className="flex items-center gap-1.5">
                <span className="h-0.5 w-3" style={{ background: series.colour }} />
                {series.symbol}
              </li>
            ))}
          </ul>
          <InteractivePlot model={model} />
        </>
      )}
    </section>
  );
}
