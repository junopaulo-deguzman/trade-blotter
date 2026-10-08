import { Router } from "express";
import { selectBooks } from "./books.repository.ts";
const router = Router();
router.get("/", async (_req, res) => res.json(await selectBooks()));
export default router;
