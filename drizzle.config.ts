import path from "node:path";

import { defineConfig } from "drizzle-kit";

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : "data";

export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: `file:${path.join(dataDir, "app.db")}` },
});
