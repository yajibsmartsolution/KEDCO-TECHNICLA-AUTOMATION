// ============================================================
// KEDCO TECHNICAL AUTOMATION
// Master Catalog Routes
// ============================================================

import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    module: "Master Catalog"
  });
});

export default router;
