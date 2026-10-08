import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticatedContext, requireAuth } from "../auth/auth.middleware.ts";
import { issueTicket } from "./tickets.ts";

const router = Router();
router.post("/ticket", rateLimit({ windowMs: 60_000, limit: 30 }), requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(issueTicket(authenticatedContext(res).tokenHash));
});
export default router;
