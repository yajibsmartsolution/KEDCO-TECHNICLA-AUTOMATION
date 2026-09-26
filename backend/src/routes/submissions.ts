// ============================================================
// KEDCO TECHNICAL AUTOMATION
// Workflow Submissions Routes
// ============================================================

import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    module: "Workflow Submissions"
  });
});

export default router;
