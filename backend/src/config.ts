import "dotenv/config";
import path from "node:path";

export const config = {
  port: Number(process.env.PORT || 3000),
  storageMode: "local" as const,
  localDataRoot: path.resolve(process.cwd(), process.env.KEDCO_LOCAL_DATA_ROOT || "../cloud data"),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000,http://localhost:5500,http://127.0.0.1:3000,http://127.0.0.1:5500"
};
