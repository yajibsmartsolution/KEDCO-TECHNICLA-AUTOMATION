// ============================================================
// KEDCO TECHNICAL AUTOMATION
// Network Routes Routes
// ============================================================

import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    module: "Network Routes"
  });
});

export default router;
