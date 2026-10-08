import { Router, type ErrorRequestHandler } from "express";
import {
  getTrades,
  getTrade,
  createTrade,
  getTradeOptions,
  cancelTrade,
  amendTrade,
} from "./trades.service.ts";
import { tradeInputSchema, tradeListSchema, tradeIdSchema } from "./trades.types.ts";
import { InputValidationError, validate } from "../shared/validation.ts";
import { requireAuth, authenticatedContext } from "../auth/auth.middleware.ts";
import { AuthError } from "../auth/auth.errors.ts";
import type { ApiErrorResponse } from "../shared/api.types.ts";
import { TradeError } from "./trades.errors.ts";
const router = Router();

router.get("/", async (req, res) =>
  res.json(await getTrades(validate(tradeListSchema, req.query))),
);
router.get("/options", async (_req, res) => res.json(await getTradeOptions()));
router.get("/:id", async (req, res) =>
  res.json(await getTrade(validate(tradeIdSchema, req.params.id))),
);
router.post("/", requireAuth, async (req, res) => {
  res
    .status(201)
    .json(
      await createTrade(validate(tradeInputSchema, req.body), authenticatedContext(res).user.id),
    );
});
router.patch("/cancel/:id", requireAuth, async (req, res) => {
  res.json(
    await cancelTrade(validate(tradeIdSchema, req.params.id), authenticatedContext(res).user.id),
  );
});
router.patch("/:id", requireAuth, async (req, res) => {
  res.json(
    await amendTrade(
      validate(tradeIdSchema, req.params.id),
      validate(tradeInputSchema, req.body),
      authenticatedContext(res).user.id,
    ),
  );
});

const handleTradeError: ErrorRequestHandler = (error, req, res, next) => {
  if (
    error instanceof TradeError &&
    ((req.method === "GET" && error.failure.reason !== "trade_not_found") ||
      (req.method === "POST" &&
        ["trade_not_found", "trade_forbidden", "trade_not_active"].includes(error.failure.reason)))
  ) {
    next(error);
    return;
  }
  if (error instanceof InputValidationError) {
    res.status(400).json({
      error: "Invalid request.",
      code: "VALIDATION_ERROR",
      fieldErrors: error.fieldErrors,
    } satisfies ApiErrorResponse);
    return;
  }
  if (
    (error instanceof AuthError && error.failure.reason === "invalid_session") ||
    (error instanceof TradeError && error.failure.reason === "recorder_not_found")
  ) {
    res.setHeader("WWW-Authenticate", "Bearer");
    res
      .status(401)
      .json({ error: "Authentication required.", code: "UNAUTHORIZED" } satisfies ApiErrorResponse);
    return;
  }
  if (error instanceof TradeError) {
    switch (error.failure.reason) {
      case "trade_not_found":
        res
          .status(404)
          .json({ error: error.message, code: "TRADE_NOT_FOUND" } satisfies ApiErrorResponse);
        return;
      case "trade_forbidden":
        res
          .status(403)
          .json({ error: error.message, code: "TRADE_FORBIDDEN" } satisfies ApiErrorResponse);
        return;
      case "trade_not_active":
        res
          .status(409)
          .json({ error: error.message, code: "TRADE_NOT_ACTIVE" } satisfies ApiErrorResponse);
        return;
      case "unknown_instrument":
      case "unknown_trader":
      case "unknown_book":
      case "unknown_counterparty": {
        const field =
          error.failure.reason === "unknown_instrument"
            ? "symbol"
            : error.failure.reason === "unknown_trader"
              ? "trader"
              : error.failure.reason === "unknown_book"
                ? "book"
                : "counterparty";
        res.status(400).json({
          error: "Invalid request.",
          code: "VALIDATION_ERROR",
          fieldErrors: { [field]: [error.message] },
        } satisfies ApiErrorResponse);
        return;
      }
    }
  }
  next(error);
};
router.use(handleTradeError);
export default router;
