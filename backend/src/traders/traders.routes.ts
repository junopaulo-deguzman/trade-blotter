import { Router } from "express";
import { getTraders } from "./traders.service.ts";
const router = Router();
router.get("/", async (_req, res) => res.json(await getTraders()));
export default router;
