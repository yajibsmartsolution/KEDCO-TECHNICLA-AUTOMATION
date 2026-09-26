// ============================================================
// KEDCO TECHNICAL AUTOMATION
// Supporting Documents Routes
// ============================================================

import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    module: "Supporting Documents"
  });
});

export default router;
