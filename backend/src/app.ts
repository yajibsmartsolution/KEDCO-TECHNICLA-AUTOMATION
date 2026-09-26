import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { config } from "./config.js";
import { errorHandler } from "./middleware/error.js";
import catalogRoutes from "./routes/catalog.js";
import filesRoutes from "./routes/files.js";
import inventoryRoutes from "./routes/inventory.js";
import networkRoutes from "./routes/network.js";
import notificationsRoutes from "./routes/notifications.js";
import submissionsRoutes from "./routes/submissions.js";
import tasksRoutes from "./routes/tasks.js";
import localAuthRoutes from "./local/auth-routes.js";
import localDataRoutes from "./local/data-routes.js";
import localOperationsRoutes from "./local/operations-routes.js";
import localAdminRoutes from "./local/admin-routes.js";
import { requireLocalAuth } from "./local/middleware.js";
import { ensureLocalLayout, localSummary } from "./local/store.js";

const app = express();
const frontendRoot = path.resolve(__dirname, "../../frontend");
// The landing page lives at the repo root (for GitHub) while every other
// page, script and asset still lives under frontend/, which is the static root.
const rootIndexHtml = path.resolve(__dirname, "../../index.html");
const localMode = true;
if (localMode) ensureLocalLayout();

const configuredOrigins = (config.corsOrigin || "").split(",").map(origin => origin.trim()).filter(Boolean);
const localOrigins = ["http://localhost:3000", "http://localhost:5500", "http://127.0.0.1:3000", "http://127.0.0.1:5500"];

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], baseUri: ["'self'"], connectSrc: ["'self'", "https:", "wss:"],
      fontSrc: ["'self'", "https:", "data:"], formAction: ["'self'"], frameAncestors: ["'self'"],
      imgSrc: ["'self'", "https:", "data:", "blob:"], objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://maps.googleapis.com", "https://maps.gstatic.com"],
      scriptSrcAttr: ["'unsafe-inline'"], styleSrc: ["'self'", "https:", "'unsafe-inline'"], workerSrc: ["'self'", "blob:"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
    }
  }
}));
app.use(cors({ origin(origin, callback) {
  if (!origin || configuredOrigins.includes("*") || configuredOrigins.includes(origin)) return callback(null, true);
  if (process.env.NODE_ENV !== "production" && (localOrigins.includes(origin) || origin === "null")) return callback(null, true);
  return callback(null, false);
}}));
app.use(express.json({ limit: "25mb" }));
app.use(morgan("combined"));

app.get("/health", (_req, res) => res.json({
  ok: true,
  service: "KEDCO Local Storage Backend",
  storage_mode: config.storageMode,
  local: localMode ? localSummary() : undefined,
  timestamp: new Date().toISOString()
}));

app.use("/api/auth", localAuthRoutes);
app.use("/api/local", localDataRoutes);
app.use("/api/admin", requireLocalAuth, localAdminRoutes);
app.use("/api/operations", requireLocalAuth, localOperationsRoutes);
// Shared endpoint groups are backed by the local file adapter.
app.use("/api/catalog", requireLocalAuth, catalogRoutes);
app.use("/api/files", requireLocalAuth, filesRoutes);
app.use("/api/inventory", requireLocalAuth, inventoryRoutes);
app.use("/api/network", requireLocalAuth, networkRoutes);
app.use("/api/notifications", requireLocalAuth, notificationsRoutes);
app.use("/api/submissions", requireLocalAuth, submissionsRoutes);
app.use("/api/tasks", requireLocalAuth, tasksRoutes);

app.get(["/", "/index.html"], (_req, res) => res.sendFile(rootIndexHtml));
// "/frontend" mirrors how a static host (e.g. GitHub Pages) serves the repo root,
// so every page/script/asset resolves identically in both environments.
app.use("/frontend", express.static(frontendRoot));
app.use(express.static(frontendRoot));
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);
export default app;
