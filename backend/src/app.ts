import express, { Router, type ErrorRequestHandler } from "express";
import tradesRouter from "./trades/trades.routes.ts";
import instrumentsRouter from "./instruments/instruments.routes.ts";
import tradersRouter from "./traders/traders.routes.ts";
import authRouter from "./auth/auth.routes.ts";
import type { ApiErrorResponse } from "./shared/api.types.ts";

import counterpartiesRouter from "./counterparties/counterparties.routes.ts";
import booksRouter from "./books/books.routes.ts";
import positionsRouter from "./positions/positions.routes.ts";
import wsRouter from "./ws/ws.routes.ts";

const app = express();
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

app.use(express.json({ limit: "32kb" }));

const api = Router();

api.get("/health", (_req, res) => res.status(200).send("OK"));
api.use("/trades", tradesRouter);
api.use("/instruments", instrumentsRouter);
api.use("/traders", tradersRouter);
api.use("/books", booksRouter);
api.use("/counterparties", counterpartiesRouter);
api.use("/positions", positionsRouter);
api.use("/auth", authRouter);
api.use("/ws", wsRouter);
app.use("/api", api);
app.use((_req, res) => {
  res
    .status(404)
    .json({ error: "Route not found.", code: "ROUTE_NOT_FOUND" } satisfies ApiErrorResponse);
});

const handleError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (
    error instanceof Error &&
    "type" in error &&
    (error.type === "entity.parse.failed" || error.type === "entity.too.large")
  ) {
    res.status(400).json({
      error: "Invalid request.",
      code: "VALIDATION_ERROR",
      fieldErrors: { body: ["Malformed or oversized JSON body."] },
    } satisfies ApiErrorResponse);
    return;
  }
  // Do not expose database details, request bodies, or authentication material.
  console.error("Unhandled request failure");
  res
    .status(500)
    .json({ error: "Internal server error.", code: "INTERNAL_ERROR" } satisfies ApiErrorResponse);
};
app.use(handleError);

export default app;
