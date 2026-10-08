import type { RequestHandler, Response } from "express";
import { authenticate } from "./auth.service.ts";
import type { AuthContext } from "./auth.types.ts";
import { AuthError } from "./auth.errors.ts";
import type { ApiErrorResponse } from "../shared/api.types.ts";

declare global {
  namespace Express {
    interface Locals {
      auth?: AuthContext;
    }
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const match = req.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i);
  if (!match) {
    res.setHeader("WWW-Authenticate", "Bearer");
    res.status(401).json({
      error: "Authentication required.",
      code: "UNAUTHORIZED",
    } satisfies ApiErrorResponse);
    return;
  }
  try {
    res.locals.auth = await authenticate(match[1]!);
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
  next();
};

export function authenticatedContext(res: Response): AuthContext {
  if (!res.locals.auth) throw new AuthError({ reason: "invalid_session" });
  return res.locals.auth;
}
