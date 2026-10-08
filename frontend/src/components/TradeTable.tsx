import { useAppDispatch, useAppSelector } from "@/store";
import { connectionSlice } from "@/store/api";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowDownUp, ArrowUp, ListFilter, EllipsisVertical } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import { inDateRange } from "@/lib/trade-date-range";
import { formatOtherEditors } from "@/lib/editor-presence";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { Editor } from "@/types/ws";
import type { Trade, TradeSide } from "@/types/api";

type TradeFilterKey = "trader" | "book" | "counterparty";
type TradeFilters = Record<TradeFilterKey, string[]>;
type SideFilter = "ALL" | TradeSide;

const filterFields: { key: TradeFilterKey; label: string }[] = [
  { key: "trader", label: "Trader" },
  { key: "book", label: "Book" },
  { key: "counterparty", label: "Counterparty" },
];

const emptyFilters: TradeFilters = {
  trader: [],
  book: [],
  counterparty: [],
};

export interface BlotterFilters {
  symbol: string | null;
  activeOnly: boolean;
  side: SideFilter;
  fromDate: string;
  toDate: string;
  selectedFilters: TradeFilters;
}
export const defaultBlotterFilters: BlotterFilters = {
  symbol: null,
  activeOnly: false,
  side: "ALL",
  fromDate: "",
  toDate: "",
  selectedFilters: emptyFilters,
};

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
  },
});

const columnHelper = createColumnHelper<typeof features, Trade>();
const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const numberFormatter = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const getColumns = (
  onCancelTrade: (tradeId: string) => void,
  onEditTrade: (trade: Trade) => void,
  canManage: (trade: Trade) => boolean,
  newTradeIds: string[],
  editors: Record<string, Editor[]>,
) =>
  columnHelper.columns([
    columnHelper.accessor("tradeId", {
      header: "Trade ID",
      cell: ({ getValue }) => {
        const tradeId = getValue();
        const editorsDescription = formatOtherEditors(editors[tradeId] ?? []);
        return (
          <span className="inline-flex items-center gap-2">
            {newTradeIds.includes(tradeId) && (
              <span
                role="img"
                aria-label="New trade"
                title="New since last refresh"
                className="size-2 shrink-0 rounded-full bg-emerald-500"
              />
            )}
            {editorsDescription && (
              <span
                role="img"
                aria-label={`Being edited by ${editorsDescription}`}
                title={`Being edited by ${editorsDescription}`}
                className="size-2 shrink-0 rounded-full bg-orange-500"
              />
            )}
            {tradeId}
          </span>
        );
      },
      sortFn: "alphanumeric",
    }),
    columnHelper.accessor("symbol", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={column.getToggleSortingHandler()}
        >
          Symbol
          {column.getIsSorted() === "asc" ? (
            <ArrowUp aria-hidden="true" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown aria-hidden="true" />
          ) : (
            <ArrowDownUp aria-hidden="true" />
          )}
        </Button>
      ),
      sortFn: "alphanumeric",
    }),
    columnHelper.accessor("side", {
      header: "Side",
      cell: ({ getValue }) => (
        <span
          className={
            getValue() === "BUY"
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-rose-700 dark:text-rose-400"
          }
        >
          {getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("quantity", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={column.getToggleSortingHandler()}
        >
          Quantity
          {column.getIsSorted() === "asc" ? (
            <ArrowUp aria-hidden="true" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown aria-hidden="true" />
          ) : (
            <ArrowDownUp aria-hidden="true" />
          )}
        </Button>
      ),
      sortFn: "basic",
      cell: ({ getValue }) => getValue().toLocaleString("en-GB"),
    }),
    columnHelper.accessor("price", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={column.getToggleSortingHandler()}
        >
          Price
          {column.getIsSorted() === "asc" ? (
            <ArrowUp aria-hidden="true" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown aria-hidden="true" />
          ) : (
            <ArrowDownUp aria-hidden="true" />
          )}
        </Button>
      ),
      sortFn: "basic",
      cell: ({ getValue }) => numberFormatter.format(getValue()),
    }),
    columnHelper.accessor("trader", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={column.getToggleSortingHandler()}
        >
          Trader
          {column.getIsSorted() === "asc" ? (
            <ArrowUp aria-hidden="true" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown aria-hidden="true" />
          ) : (
            <ArrowDownUp aria-hidden="true" />
          )}
        </Button>
      ),
      sortFn: "basic",
    }),
    columnHelper.accessor("book", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={column.getToggleSortingHandler()}
        >
          Book
          {column.getIsSorted() === "asc" ? (
            <ArrowUp aria-hidden="true" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown aria-hidden="true" />
          ) : (
            <ArrowDownUp aria-hidden="true" />
          )}
        </Button>
      ),
      sortFn: "alphanumeric",
    }),
    columnHelper.accessor("counterparty", {
      header: "Counterparty",
      sortFn: "alphanumeric",
    }),
    columnHelper.accessor("tradeTimestamp", {
      header: "Trade time (UTC)",
      sortFn: "alphanumeric",
      cell: ({ getValue }) => dateTimeFormatter.format(new Date(getValue())),
    }),
    columnHelper.accessor("status", {
      header: "Status",
      sortFn: "alphanumeric",
    }),
    columnHelper.display({
      id: "actions",

      cell: ({ row }) => {
        // hide actions for trades that cannot be managed
        if (!canManage(row.original)) {
          return null;
        }
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${row.original.tradeId}`}
                />
              }
            >
              <EllipsisVertical aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!canManage(row.original)}
                onClick={() => onEditTrade(row.original)}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={!canManage(row.original)}
                onClick={() => onCancelTrade(row.original.tradeId)}
              >
                Cancel trade
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    }),
  ]);

function getFilterValues(trades: Trade[]): Record<TradeFilterKey, string[]> {
  return {
    trader: [...new Set(trades.map((trade) => trade.trader))].sort(),
    book: [...new Set(trades.map((trade) => trade.book))].sort(),
    counterparty: [...new Set(trades.map((trade) => trade.counterparty))].sort(),
  };
}

interface TradeTableProps {
  filters: BlotterFilters;
  onFiltersChange: (filters: BlotterFilters) => void;
  trades: Trade[];
  onCancelTrade: (tradeId: string) => void;
  onEditTrade: (trade: Trade) => void;
  isCancelling: boolean;
}

export default function TradeTable({
  filters,
  onFiltersChange,
  trades,
  onCancelTrade,
  onEditTrade,
  isCancelling,
}: TradeTableProps) {
  const dispatch = useAppDispatch();
  const { newTradeIds, pendingTradeIds, highlights, editors } = useAppSelector(
    (state) => state.connection,
  );
  const auth = useAppSelector((state) => state.auth);
  const columns = useMemo(
    () =>
      getColumns(
        onCancelTrade,
        onEditTrade,
        (trade) => !isCancelling && auth.status === "authenticated" && trade.status === "ACTIVE",
        newTradeIds,
        editors,
      ),
    [onCancelTrade, onEditTrade, isCancelling, auth.status, newTradeIds, editors],
  );
  const { symbol, activeOnly, side, fromDate, toDate, selectedFilters } = filters;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });

  const filterValues = useMemo(() => getFilterValues(trades), [trades]);
  const filteredTrades = useMemo(
    () =>
      trades.filter((trade) => {
        if (pendingTradeIds.includes(trade.tradeId)) return false;
        if (symbol && trade.symbol !== symbol) return false;
        if (activeOnly && trade.status !== "ACTIVE") return false;
        if (side !== "ALL" && trade.side !== side) return false;
        if (!inDateRange(trade, { fromDate, toDate })) return false;
        return filterFields.every(({ key }) => {
          const selected = selectedFilters[key];
          return selected.length === 0 || selected.includes(trade[key]);
        });
      }),
    [trades, symbol, side, fromDate, toDate, selectedFilters, activeOnly, pendingTradeIds],
  );

  const table = useTable({
    features,
    columns,
    data: filteredTrades,
    getRowId: (trade) => trade.tradeId,
    autoResetPageIndex: false,
    state: { sorting, pagination },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPagination((current) => ({ ...current, pageIndex: 0 }));
    },
    onPaginationChange: setPagination,
  });

  const previousFilters = useRef(filters);
  useEffect(() => {
    if (previousFilters.current !== filters) {
      previousFilters.current = filters;
      table.setPageIndex(0);
    }
  }, [filters, table]);

  const pageCount = Math.max(table.getPageCount(), 1);
  useEffect(() => {
    if (pagination.pageIndex >= pageCount) table.setPageIndex(pageCount - 1);
  }, [pageCount, pagination.pageIndex, table]);

  const activeFilterCount = Object.values(selectedFilters).reduce(
    (count, values) => count + values.length,
    0,
  );
  const filtersAreActive =
    symbol !== null ||
    activeOnly ||
    side !== "ALL" ||
    fromDate !== "" ||
    toDate !== "" ||
    activeFilterCount > 0;

  function updateFilter(key: TradeFilterKey, value: string, checked: boolean) {
    onFiltersChange({
      ...filters,
      selectedFilters: {
        ...selectedFilters,
        [key]: checked
          ? [...selectedFilters[key], value]
          : selectedFilters[key].filter((item) => item !== value),
      },
    });
    table.setPageIndex(0);
  }

  function resetFilters() {
    onFiltersChange(defaultBlotterFilters);
    table.setPageIndex(0);
  }

  function showNewTrades() {
    resetFilters();
    table.setSorting([]);
    dispatch(
      connectionSlice.actions.newTradesShown(
        trades
          .filter((trade) => trade.status === "ACTIVE" && pendingTradeIds.includes(trade.tradeId))
          .map((trade) => trade.tradeId),
      ),
    );
  }

  return (
    <section className="space-y-4" aria-label="Trade activity">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter trades by side"
          className="inline-flex overflow-hidden border border-border"
        >
          {(
            [
              ["ALL", "All"],
              ["BUY", "Buy side"],
              ["SELL", "Sell side"],
            ] as const
          ).map(([value, label], index) => (
            <Button
              key={value}
              variant={side === value ? "secondary" : "ghost"}
              size="sm"
              className={index > 0 ? "border-l border-border" : ""}
              aria-pressed={side === value}
              onClick={() => {
                onFiltersChange({ ...filters, side: value });
                table.setPageIndex(0);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {filteredTrades.length} {filteredTrades.length === 1 ? "trade" : "trades"}
          </p>
          {pendingTradeIds.length > 0 && (
            <Button variant="secondary" size="sm" onClick={showNewTrades}>
              <span aria-live="polite">Show new trades ({pendingTradeIds.length})</span>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Button
          variant={activeOnly ? "secondary" : "outline"}
          aria-pressed={activeOnly}
          onClick={() => {
            onFiltersChange({ ...filters, activeOnly: !activeOnly });
            table.setPageIndex(0);
          }}
        >
          Active only
        </Button>
        <Popover.Root>
          <Popover.Trigger
            render={
              <Button variant="outline" aria-label="Open additional trade filters">
                <ListFilter aria-hidden="true" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-1 tabular-nums">{activeFilterCount}</span>
                )}
              </Button>
            }
          />
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="start" sideOffset={6}>
              <Popover.Popup className="z-50 max-h-[min(34rem,80vh)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto border border-border bg-popover p-4 text-popover-foreground shadow-lg">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Popover.Title className="text-sm font-semibold">
                    Additional filters
                  </Popover.Title>
                  <div className="flex items-center gap-1">
                    {filtersAreActive && (
                      <Button variant="ghost" size="sm" onClick={resetFilters}>
                        Reset
                      </Button>
                    )}
                    <Popover.Close
                      render={
                        <Button variant="ghost" size="icon-sm" aria-label="Close filters">
                          <span aria-hidden="true">×</span>
                        </Button>
                      }
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  {filterFields.map(({ key, label }) => (
                    <fieldset key={key} className="space-y-2">
                      <legend className="text-xs font-semibold uppercase text-muted-foreground">
                        {label}
                      </legend>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                        {filterValues[key].map((value) => (
                          <label key={value} className="flex min-w-0 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={selectedFilters[key].includes(value)}
                              onChange={(event) => updateFilter(key, value, event.target.checked)}
                              className="size-4 accent-primary"
                            />
                            <span className="truncate">{value}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <div className="border border-border">
        <Table aria-label="Trade blotter" className="min-w-280">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={
                    row.original.status === "CANCELLED"
                      ? "opacity-50"
                      : highlights[row.original.tradeId] === "created"
                        ? "animate-trade-highlight motion-reduce:animate-none"
                        : highlights[row.original.tradeId] === "amended"
                          ? "animate-trade-edit-highlight motion-reduce:animate-none"
                          : undefined
                  }
                  onAnimationEnd={() =>
                    dispatch(connectionSlice.actions.highlightCleared(row.original.tradeId))
                  }
                >
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No trades match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-sm text-muted-foreground">
          Page {pagination.pageIndex + 1} of {pageCount}
        </p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Rows
            <select
              aria-label="Rows per page"
              value={pagination.pageSize}
              onChange={(event) => table.setPageSize(Number(event.target.value))}
              className="h-9 border border-input bg-background px-2 text-sm text-foreground"
            >
              {[10, 25, 50].map((pageSize) => (
                <option key={pageSize} value={pageSize}>
                  {pageSize}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ArrowUp aria-hidden="true" className="-rotate-90" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ArrowDown aria-hidden="true" className="-rotate-90" />
          </Button>
        </div>
      </div>
    </section>
  );
}
