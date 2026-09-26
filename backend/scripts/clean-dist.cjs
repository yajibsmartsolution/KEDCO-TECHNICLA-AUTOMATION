const fs = require("node:fs");
const path = require("node:path");
const backendRoot = path.resolve(__dirname, "..");
const outputDir = path.resolve(backendRoot, "dist");
if (path.dirname(outputDir) !== backendRoot || path.basename(outputDir) !== "dist") {
  throw new Error("Refusing to clean a build directory outside backend/dist.");
}
fs.rmSync(outputDir, { recursive: true, force: true });
