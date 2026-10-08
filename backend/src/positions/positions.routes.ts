import { Router } from "express";
import { selectOpeningHoldings } from "./positions.repository.ts";
const router = Router();
router.get("/opening", async (_req, res) => res.json(await selectOpeningHoldings()));
export default router;
