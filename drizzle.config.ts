import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./admin/server/db/schema.ts",
  out: "./admin/server/db/migrations",
});
