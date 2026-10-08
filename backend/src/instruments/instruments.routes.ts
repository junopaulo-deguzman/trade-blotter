import { Router } from "express";
import { getInstruments } from "./instruments.service.ts";
const router = Router();
router.get("/", async (_req, res) => res.json(await getInstruments()));
export default router;
