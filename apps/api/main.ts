import "dotenv/config";
import { connectDatabase } from "../../packages/core/db.js";
import { buildServer } from "./server.js";
import pino from "pino";

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required; see .env.example.");
const db = connectDatabase(process.env.DATABASE_URL);
const logger = pino({
  redact: ["password", "token", "cookie", "authorization"],
});
const app = await buildServer({
  db,
  origin: process.env.APP_ORIGIN ?? "http://localhost:3100",
  backgroundMode:
    process.env.BACKGROUND_MODE === "bullmq" ? "bullmq" : "disabled",
  log: ({ level, ...entry }) => {
    if (level === "error") logger.error(entry);
    else logger.info(entry);
  },
});
await app.listen({
  port: Number(process.env.API_PORT ?? 3101),
  host: "0.0.0.0",
});
async function stop() {
  await app.close();
  await db.$disconnect();
}
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
