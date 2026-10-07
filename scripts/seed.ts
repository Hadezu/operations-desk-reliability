import "dotenv/config";
import { connectDatabase } from "../packages/core/db.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required.");
const db = connectDatabase(process.env.DATABASE_URL);
await db.$queryRaw`SELECT 1`;
console.log(
  "Database ready. Demo data is seeded per visitor by POST /api/demo; no shared public credentials.",
);
await db.$disconnect();
