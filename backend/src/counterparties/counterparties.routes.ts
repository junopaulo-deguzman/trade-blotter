import { Router } from "express";
import { selectCounterparties } from "./counterparties.repository.ts";
const router = Router();
router.get("/", async (_req, res) => res.json(await selectCounterparties()));
export default router;
