// ============================================================
// KEDCO TECHNICAL AUTOMATION
// Backend Server Entry Point
// ============================================================

import app from "./app.js";
import { config } from "./config.js";

app.listen(config.port, () => {
  console.log(`KEDCO backend running on port ${config.port}`);
});
