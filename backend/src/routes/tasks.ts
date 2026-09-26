// ============================================================
// KEDCO TECHNICAL AUTOMATION
// Workflow Tasks Routes
// ============================================================

import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    module: "Workflow Tasks"
  });
});

export default router;
