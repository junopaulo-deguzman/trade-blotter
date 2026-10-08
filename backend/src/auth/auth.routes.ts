import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { login, logout } from "./auth.service.ts";
import { requireAuth, authenticatedContext } from "./auth.middleware.ts";
import { loginSchema } from "./auth.types.ts";
import { InputValidationError, validate } from "../shared/validation.ts";
import type { ApiErrorResponse } from "../shared/api.types.ts";
import { AuthError } from "./auth.errors.ts";
const router = Router();
router.post(
  "/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: "Too many login attempts. Try again later.",
        code: "RATE_LIMITED",
      } satisfies ApiErrorResponse);
    },
  }),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json(await login(validate(loginSchema, req.body)));
    } catch (error) {
      if (error instanceof InputValidationError) {
        res.status(400).json({
          error: "Invalid request.",
          code: "VALIDATION_ERROR",
          fieldErrors: error.fieldErrors,
        } satisfies ApiErrorResponse);
        return;
      }
      if (error instanceof AuthError && error.failure.reason === "invalid_credentials") {
        res.setHeader("WWW-Authenticate", "Bearer");
        res.status(401).json({
          error: "Invalid username or password.",
          code: "INVALID_CREDENTIALS",
        } satisfies ApiErrorResponse);
        return;
      }
      throw error;
    }
  },
);
router.get("/me", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json(authenticatedContext(res).user);
  } catch (error) {
    if (error instanceof AuthError && error.failure.reason === "invalid_session") {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json({
        error: "Authentication required.",
        code: "UNAUTHORIZED",
      } satisfies ApiErrorResponse);
      return;
    }
    throw error;
  }
});
router.post("/logout", requireAuth, async (_req, res) => {
  try {
    await logout(authenticatedContext(res).tokenHash);
    res.status(204).end();
  } catch (error) {
    if (error instanceof AuthError && error.failure.reason === "invalid_session") {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json({
        error: "Authentication required.",
        code: "UNAUTHORIZED",
      } satisfies ApiErrorResponse);
      return;
    }
    throw error;
  }
});
export default router;
