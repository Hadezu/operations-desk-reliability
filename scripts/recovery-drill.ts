import "dotenv/config";
import pg from "pg";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Bounded logical application backup, not a physical/WAL backup or pg_dump substitute.
// Only a loopback disposable cluster is accepted, and the destination is always new.
const source = new URL(process.env.MIGRATION_DATABASE_URL!);
if (!["127.0.0.1", "localhost"].includes(source.hostname))
  throw Error("Disposable loopback PostgreSQL required");
const tables = [
  "workspaces",
  "organizations",
  "members",
  "sessions",
  "requests",
  "audit_events",
  "commands",
  "outbox_events",
  "reports",
  "job_attempts",
  "association_revisions",
  "booking_revisions",
];
const admin = new pg.Client({ connectionString: source.toString() });
await admin.connect();
const id = "recovery_" + randomUUID().replaceAll("-", "");
const destination = new URL(source);
destination.pathname = "/" + id;
const backupPath = resolve(".local", id + ".json");
await mkdir(".local", { recursive: true });
const rows: Record<string, unknown[]> = {};
await admin.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
for (const table of tables)
  rows[table] = (
    await admin.query(
      `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
    )
  ).rows.map((r) => r.row);
await admin.query("COMMIT");
if (!rows.association_revisions.length)
  throw Error("Seed and test the association module before recovery drill");
const payload = JSON.stringify(rows);
const digest = createHash("sha256").update(payload).digest("hex");
await writeFile(backupPath, JSON.stringify({ digest, rows }, null, 2));
await admin.query(`CREATE DATABASE ${id}`);
try {
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      stdio: "pipe",
      windowsHide: true,
      env: { ...process.env, MIGRATION_DATABASE_URL: destination.toString() },
    },
  );
  const restored = new pg.Client({ connectionString: destination.toString() });
  await restored.connect();
  try {
    const saved = JSON.parse(await readFile(backupPath, "utf8"));
    if (
      createHash("sha256").update(JSON.stringify(saved.rows)).digest("hex") !==
      saved.digest
    )
      throw Error("Backup digest mismatch");
    await restored.query("BEGIN");
    for (const table of tables)
      await restored.query(
        `INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table},$1::json)`,
        [JSON.stringify(saved.rows[table])],
      );
    await restored.query("COMMIT");
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const actual = (
        await restored.query(
          `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
        )
      ).rows.map((r) => r.row);
      if (JSON.stringify(actual) !== JSON.stringify(rows[table]))
        throw Error(`Restore mismatch: ${table}`);
      counts[table] = actual.length;
    }
    // Reproduce failed DDL in the RESTORED database, never the source.
    let failed = false;
    await restored.query("BEGIN");
    try {
      await restored.query("CREATE TABLE failed_migration_probe(id integer)");
      await restored.query("SELECT deliberately_missing_function()");
    } catch {
      failed = true;
      await restored.query("ROLLBACK");
    }
    if (
      !failed ||
      (
        await restored.query(
          "SELECT to_regclass('public.failed_migration_probe') AS name",
        )
      ).rows[0].name !== null
    )
      throw Error("Failed migration did not roll back");
    const health =
      (await restored.query("SELECT 1 AS ready")).rows[0].ready === 1;
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    await mkdir("evidence", { recursive: true });
    await writeFile(
      "evidence/recovery-drill.json",
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          sha,
          kind: "bounded application-table logical backup",
          source: "loopback disposable database",
          destination: id,
          backupSha256: digest,
          counts,
          restoreEqual: true,
          failedMigrationRolledBack: true,
          health,
          limitations: [
            "Same PostgreSQL cluster, separate database; not a regional disaster test",
            "No role, extension, WAL or external-system backup",
            "Backup contains synthetic session records and stays in ignored .local",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        restoreEqual: true,
        failedMigrationRolledBack: true,
        health,
        counts,
      }),
    );
  } finally {
    await restored.end();
  }
} finally {
  // id is generated above, never supplied by a user or read from a backup.
  await admin.query(`DROP DATABASE ${id} WITH (FORCE)`);
  await admin.end();
}
