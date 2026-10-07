import "dotenv/config";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { provisionRole } from "./provision-role.js";
if (!process.env.MIGRATION_DATABASE_URL || !process.env.DATABASE_URL)
  throw Error("Database URLs required.");
const migration = spawn(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { stdio: "inherit", windowsHide: true },
);
const [code] = await once(migration, "exit");
if (code !== 0) throw Error("Migration failed.");
await provisionRole(
  process.env.MIGRATION_DATABASE_URL,
  process.env.DATABASE_URL,
);
console.log(
  "Schema and restricted application role ready. Demo fixtures are created per visitor.",
);
