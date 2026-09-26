// ============================================================
// KEDCO TECHNICAL AUTOMATION
// Notifications Routes
// ============================================================

import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    module: "Notifications"
  });
});

export default router;
