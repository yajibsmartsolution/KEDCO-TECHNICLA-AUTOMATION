// ============================================================
// KEDCO TECHNICAL AUTOMATION
// Stores and Inventory Routes
// ============================================================

import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    module: "Stores and Inventory"
  });
});

export default router;
