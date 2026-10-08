import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { LoaderCircle, Plus, X } from "lucide-react";
import { useCreateTrade, useAmendTrade, useTradeOptions } from "@/hooks/use-trades";
import {
  defaultTradeForm,
  tradeToForm,
  tradeTimeToIso,
  readableTradeSummary,
  type TradeFormValues,
} from "@/lib/trade-form";
import { latestExecutions, formatPrice, formatExecutionTime } from "@/lib/execution-prices";
import { formatOtherEditors } from "@/lib/editor-presence";
import type { Trade } from "@/types/api";
import { tradesApi, setEditingTrade } from "@/store/api";
import { useAppDispatch, useAppSelector } from "@/store";
import type { RequestError } from "@/lib/http-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

interface TradeDrawerProps {
  trade?: Trade;
  onClose?: () => void;
  onCreated?: (trade: Trade) => void;
}

function FormField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export default function TradeDrawer({ trade, onCreated, onClose }: TradeDrawerProps) {
  const [open, setOpen] = useState(!!trade);
  const [symbolQuery, setSymbolQuery] = useState(trade?.symbol ?? "");
  const id = useId();
  const symbolRef = useRef<HTMLInputElement>(null);
  const optionsQuery = useTradeOptions(open);
  const creation = useCreateTrade();
  const amendment = useAmendTrade(trade?.tradeId ?? "");
  const mutation = trade ? amendment : creation;
  const actionLabel = trade ? "Edit trade" : "Create trade";
  const authStatus = useAppSelector((state) => state.auth.status);
  const dispatch = useAppDispatch();
  const openingTrade = useRef(trade).current;
  const latest = useAppSelector((state) =>
    trade
      ? tradesApi.endpoints.getTrades
          .select()(state)
          .data?.find((row) => row.tradeId === trade.tradeId)
      : undefined,
  );
  const connection = useAppSelector((state) => state.connection);
  const otherEditors = trade
    ? (connection.editors[trade.tradeId] ?? []).filter(
        (editor) => editor.connectionId !== connection.connectionId,
      )
    : [];
  const cancelled = latest?.status === "CANCELLED";
  const unavailable = !!trade && !latest;
  const changed =
    !!latest &&
    !!openingTrade &&
    JSON.stringify(tradeToForm(latest)) !== JSON.stringify(tradeToForm(openingTrade));
  const saving = useRef(false);
  const canSave = authStatus === "authenticated" && !cancelled && !unavailable;
  useEffect(() => {
    if (!open || !trade || authStatus !== "authenticated" || cancelled) return;
    dispatch(setEditingTrade(trade.tradeId));
    return () => {
      dispatch(setEditingTrade(null));
    };
  }, [open, trade, authStatus, cancelled, dispatch]);
  const form = useForm<TradeFormValues>({
    defaultValues: trade ? tradeToForm(trade) : defaultTradeForm(),
    mode: "onSubmit",
  });
  const values = useWatch({ control: form.control }) as TradeFormValues;
  const cachedTrades = useAppSelector(
    (state) => tradesApi.endpoints.getTrades.select()(state).data,
  );
  const reference = useMemo(
    () => (open && !trade ? latestExecutions(cachedTrades ?? []).get(values.symbol) : undefined),
    [open, trade, cachedTrades, values.symbol],
  );
  const { errors } = form.formState;
  const options = optionsQuery.data;
  const disabled =
    mutation.isPending || !options || optionsQuery.isError || cancelled || unavailable;
  const quantity = Number(values.quantity);
  const price = Number(values.price);
  const total = quantity * price;
  const hasTotal = quantity > 0 && price > 0 && Number.isFinite(total);

  useEffect(() => {
    if (open && options) symbolRef.current?.focus();
  }, [open, options]);

  function resetForm() {
    form.reset(defaultTradeForm());
    setSymbolQuery("");
  }

  const submit = form.handleSubmit(async (fields) => {
    if (saving.current || !canSave) return;
    const tradeTimestamp = tradeTimeToIso(fields.executionTime);
    if (!tradeTimestamp || !fields.side) return;
    saving.current = true;
    try {
      const trade = await mutation.save({
        symbol: fields.symbol,
        side: fields.side,
        quantity: Number(fields.quantity),
        price: Number(fields.price),
        trader: fields.trader,
        book: fields.book,
        counterparty: fields.counterparty,
        tradeTimestamp,
      });
      resetForm();
      setOpen(false);
      onCreated?.(trade);
      onClose?.();
    } catch (error) {
      const fields = (error as RequestError).fieldErrors;
      for (const [name, messages] of Object.entries(fields ?? {})) {
        const field = name === "tradeTimestamp" ? "executionTime" : name;
        if (field in form.getValues())
          form.setError(field as keyof TradeFormValues, { type: "server", message: messages[0] });
        else form.setError("root", { type: "server", message: messages[0] });
      }
    } finally {
      saving.current = false;
    }
  });

  return (
    <Drawer
      modal={false}
      swipeDirection="right"
      disablePointerDismissal
      open={open}
      onOpenChange={(nextOpen) => {
        if (mutation.isPending) return;
        if (nextOpen) mutation.reset();
        setOpen(nextOpen);
        if (!nextOpen) onClose?.();
      }}
    >
      {!trade && (
        <DrawerTrigger render={<Button />}>
          <Plus aria-hidden="true" /> Create trade
        </DrawerTrigger>
      )}
      <DrawerContent
        initialFocus={symbolRef}
        className="shadow-2xl data-[swipe-axis=x]:[--drawer-content-width:100%] data-[swipe-axis=x]:sm:[--drawer-content-width:30rem]"
      >
        <DrawerHeader className="gap-2 border-b p-6">
          <div className="flex items-center justify-between gap-4">
            <DrawerTitle>
              {actionLabel}
              {trade ? ` ${trade.tradeId}` : ""}
            </DrawerTitle>
            <DrawerClose
              disabled={mutation.isPending}
              render={<Button variant="ghost" size="icon-sm" aria-label="Close trade drawer" />}
            >
              <X aria-hidden="true" />
            </DrawerClose>
          </div>
          <DrawerDescription>
            {trade
              ? "Update the details of this active trade."
              : "Record an executed trade. Buy and sell refer to the selected trader’s book."}
          </DrawerDescription>
        </DrawerHeader>

        <form
          id={`${id}-form`}
          onSubmit={submit}
          noValidate
          className="min-h-0 flex-1 overflow-y-auto p-6"
          aria-busy={mutation.isPending}
        >
          <div className="space-y-6">
            {otherEditors.length > 0 && (
              <p
                role="status"
                className="border border-orange-400 bg-orange-50 p-3 text-sm text-orange-950"
              >
                Also being edited by {formatOtherEditors(otherEditors)}
              </p>
            )}
            {cancelled ? (
              <p role="status" className="border p-3 text-sm">
                This trade has been cancelled. Amendments can’t be saved. Your entries have been
                kept.
              </p>
            ) : unavailable ? (
              <p role="status" className="border p-3 text-sm">
                This trade is unavailable. Refresh the blotter before saving.
              </p>
            ) : (
              changed && (
                <p
                  role="status"
                  className="border border-orange-400 bg-orange-50 p-3 text-sm text-orange-950"
                >
                  This trade changed while you were editing. Your entries have been kept. Saving
                  will overwrite the latest values.
                </p>
              )
            )}
            {optionsQuery.isPending && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Loading trade
                options…
              </p>
            )}
            {optionsQuery.isError && (
              <div role="alert" className="space-y-2 text-sm text-destructive">
                <p>Could not load trade options. {optionsQuery.error?.message}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void optionsQuery.refetch()}
                >
                  Try again
                </Button>
              </div>
            )}

            <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
              <legend className="mb-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Trade details
              </legend>
              <Controller
                control={form.control}
                name="symbol"
                rules={{
                  validate: (value) =>
                    (!!value && !!options?.symbols.includes(value)) ||
                    "Select a symbol from the suggestions.",
                }}
                render={({ field, fieldState }) => (
                  <FormField id={`${id}-symbol`} label="Symbol" error={fieldState.error?.message}>
                    <Combobox
                      modal={false}
                      items={options?.symbols ?? []}
                      value={field.value || null}
                      inputValue={symbolQuery}
                      disabled={disabled}
                      autoHighlight
                      onValueChange={(value) => {
                        field.onChange(value ?? "");
                        setSymbolQuery(value ?? "");
                      }}
                      onInputValueChange={(value, details) => {
                        setSymbolQuery(value);
                        if (details.reason === "input-change") {
                          const symbol = value.trim().toUpperCase();
                          field.onChange(options?.symbols.includes(symbol) ? symbol : "");
                        }
                      }}
                    >
                      <ComboboxInput
                        id={`${id}-symbol`}
                        ref={(element) => {
                          symbolRef.current = element;
                          field.ref(element);
                        }}
                        onBlur={field.onBlur}
                        placeholder="Search symbol…"
                        aria-invalid={!!fieldState.error}
                        aria-describedby={fieldState.error ? `${id}-symbol-error` : undefined}
                        className="w-full"
                        showClear
                      />
                      <ComboboxContent>
                        <ComboboxEmpty>No matching symbols.</ComboboxEmpty>
                        <ComboboxList>
                          {(symbol: string) => (
                            <ComboboxItem key={symbol} value={symbol}>
                              {symbol}
                            </ComboboxItem>
                          )}
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                  </FormField>
                )}
              />

              <Controller
                control={form.control}
                name="side"
                rules={{ required: "Choose buy or sell." }}
                render={({ field, fieldState }) => (
                  <FormField id={`${id}-side`} label="Side" error={fieldState.error?.message}>
                    <div
                      id={`${id}-side`}
                      role="group"
                      aria-label="Trade side"
                      aria-describedby={fieldState.error ? `${id}-side-error` : undefined}
                      className="grid grid-cols-2 gap-2"
                    >
                      {(["BUY", "SELL"] as const).map((side, index) => (
                        <Button
                          key={side}
                          ref={index === 0 ? field.ref : undefined}
                          type="button"
                          variant={field.value === side ? "default" : "outline"}
                          aria-pressed={field.value === side}
                          onClick={() => field.onChange(side)}
                          onBlur={field.onBlur}
                          disabled={disabled}
                        >
                          {side === "BUY" ? "Buy" : "Sell"}
                        </Button>
                      ))}
                    </div>
                  </FormField>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField id={`${id}-quantity`} label="Quantity" error={errors.quantity?.message}>
                  <Input
                    id={`${id}-quantity`}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="2147483647"
                    step="1"
                    placeholder="e.g. 1,200"
                    aria-invalid={!!errors.quantity}
                    aria-describedby={errors.quantity ? `${id}-quantity-error` : undefined}
                    {...form.register("quantity", {
                      validate: (value) =>
                        (Number.isInteger(Number(value)) &&
                          Number(value) > 0 &&
                          Number(value) <= 2147483647) ||
                        "Enter a whole number from 1 to 2,147,483,647.",
                    })}
                  />
                </FormField>
                <FormField id={`${id}-price`} label="Price" error={errors.price?.message}>
                  <Input
                    id={`${id}-price`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder="e.g. 227.45"
                    aria-invalid={!!errors.price}
                    aria-describedby={
                      [
                        errors.price ? `${id}-price-error` : "",
                        !trade && values.symbol ? `${id}-price-reference` : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    {...form.register("price", {
                      validate: (value) =>
                        (Number.isFinite(Number(value)) &&
                          Number(value) > 0 &&
                          Number.isFinite(Number(value) * Number(form.getValues("quantity")))) ||
                        "Enter a price greater than zero.",
                    })}
                  />
                  {!trade && values.symbol && (
                    <div
                      id={`${id}-price-reference`}
                      className="space-y-1 text-xs text-muted-foreground"
                    >
                      {reference ? (
                        <>
                          <p>
                            Last execution:{" "}
                            <span className="font-medium text-foreground">
                              {formatPrice.format(reference.price)}
                            </span>
                          </p>
                          <p>{formatExecutionTime(reference.tradeTimestamp)}</p>
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={disabled}
                            onClick={() =>
                              form.setValue("price", String(reference.price), {
                                shouldDirty: true,
                                shouldValidate: true,
                              })
                            }
                          >
                            Use last price
                          </Button>
                        </>
                      ) : (
                        <p>No active execution price available.</p>
                      )}
                    </div>
                  )}
                </FormField>
              </div>
            </fieldset>

            <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
              <legend className="mb-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Allocation
              </legend>
              {(
                [
                  {
                    name: "trader",
                    label: "Trader",
                    items: options?.traders ?? [],
                  },
                  { name: "book", label: "Book", items: options?.books ?? [] },
                  {
                    name: "counterparty",
                    label: "Counterparty",
                    items: options?.counterparties ?? [],
                  },
                ] as const
              ).map(({ name, label, items }) => (
                <Controller
                  key={name}
                  control={form.control}
                  name={name}
                  rules={{
                    validate: (value) =>
                      items.includes(value) || `Select a ${label.toLowerCase()}.`,
                  }}
                  render={({ field, fieldState }) => (
                    <FormField id={`${id}-${name}`} label={label} error={fieldState.error?.message}>
                      <Select
                        modal={false}
                        items={items.map((value) => ({ value, label: value }))}
                        value={field.value || null}
                        onValueChange={(value: string | null) => field.onChange(value ?? "")}
                        disabled={disabled}
                      >
                        <SelectTrigger
                          id={`${id}-${name}`}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          className="w-full"
                          aria-invalid={!!fieldState.error}
                          aria-describedby={fieldState.error ? `${id}-${name}-error` : undefined}
                        >
                          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
                        </SelectTrigger>
                        <SelectContent align="start" alignItemWithTrigger={false}>
                          {items.map((value) => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                />
              ))}
            </fieldset>

            <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
              <legend className="mb-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Execution
              </legend>
              <FormField
                id={`${id}-time`}
                label="Execution date and time (UTC)"
                error={errors.executionTime?.message}
              >
                <Input
                  id={`${id}-time`}
                  type="datetime-local"
                  step="1"
                  aria-invalid={!!errors.executionTime}
                  aria-describedby={errors.executionTime ? `${id}-time-error` : `${id}-time-help`}
                  {...form.register("executionTime", {
                    validate: (value) =>
                      !!tradeTimeToIso(value) || "Enter a valid execution date and time.",
                  })}
                />
                <p id={`${id}-time-help`} className="text-xs text-muted-foreground">
                  Use the actual execution time. New trades are recorded as Active.
                </p>
              </FormField>
            </fieldset>

            <div className="space-y-3 border bg-muted/40 p-4">
              <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Trade summary
              </h3>
              <p className="text-sm leading-relaxed" aria-live="polite" aria-atomic="true">
                {readableTradeSummary(values)}
              </p>
              <div className="flex items-center justify-between gap-4 border-t pt-3 text-sm">
                <span className="text-muted-foreground">Trade value</span>
                <output className="font-semibold tabular-nums">
                  {hasTotal
                    ? total.toLocaleString("en-GB", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : "—"}
                </output>
              </div>
            </div>
            {mutation.isError && (
              <p role="alert" className="text-sm text-destructive">
                Could not save this trade. {mutation.error?.message} Your entries have been kept.
              </p>
            )}
          </div>
        </form>

        <DrawerFooter className="flex-row justify-end border-t bg-background p-4 sm:px-6">
          <DrawerClose disabled={mutation.isPending} render={<Button variant="outline" />}>
            Close
          </DrawerClose>
          {authStatus !== "authenticated" && (
            <p role="status" className="mr-auto self-center text-xs text-muted-foreground">
              Log in above to save this trade.
            </p>
          )}
          <Button type="submit" form={`${id}-form`} disabled={disabled || !canSave}>
            {mutation.isPending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {mutation.isPending ? "Saving…" : trade ? "Save changes" : "Create trade"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
