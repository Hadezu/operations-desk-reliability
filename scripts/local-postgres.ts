import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { provisionRole } from "./provision-role.js";

// Real PostgreSQL binaries, loopback-only. No system service, no Docker required.
const databaseDir = resolve(".local/postgres");
await mkdir(".local", { recursive: true });
const cluster = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "local-owner-password",
  port: 55432,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: (message) => {
    if (String(message).includes("FATAL"))
      console.error("PostgreSQL startup error.");
  },
});
if (!existsSync(resolve(databaseDir, "PG_VERSION"))) await cluster.initialise();
await cluster.start();
const owner = cluster.getPgClient();
await owner.connect();
const found = await owner.query(
  "SELECT 1 FROM pg_database WHERE datname='desk'",
);
if (!found.rows.length) await owner.query("CREATE DATABASE desk");
await owner.end();
const ownerUrl =
  "postgresql://postgres:local-owner-password@127.0.0.1:55432/desk";
const appUrl = "postgresql://desk_app:local-app-password@127.0.0.1:55432/desk";
const migration = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  {
    stdio: "inherit",
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
  },
);
if (migration.status !== 0) {
  await cluster.stop();
  process.exit(1);
}
await provisionRole(ownerUrl, appUrl);
if (!existsSync(".env"))
  await writeFile(
    ".env",
    `DATABASE_URL=${appUrl}\nMIGRATION_DATABASE_URL=${ownerUrl}\nAPP_ORIGIN=http://localhost:3100\nAPI_PORT=3101\nBACKGROUND_MODE=disabled\n`,
  );
console.log(
  "PostgreSQL ready on 127.0.0.1:55432. Local .env configured. Keep this process running.",
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await cluster.stop();
  process.exit(0);
}
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
setInterval(() => {}, 60000);
