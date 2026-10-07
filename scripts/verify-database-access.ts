import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";

const appUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.MIGRATION_DATABASE_URL;
if (!appUrl || !ownerUrl || appUrl === ownerUrl)
  throw Error("Distinct application and migration database URLs are required.");

const app = new pg.Client({
  connectionString: appUrl,
  connectionTimeoutMillis: 15000,
});
const owner = new pg.Client({
  connectionString: ownerUrl,
  connectionTimeoutMillis: 15000,
});
const checked: string[] = [];
try {
  await app.connect();
  await owner.connect();
  const identityQuery = `SELECT session_user, current_user, current_database() AS database,
    rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolinherit
    FROM pg_roles WHERE rolname = session_user`;
  const identity = (await app.query(identityQuery)).rows[0];
  const migrationIdentity = (await owner.query(identityQuery)).rows[0];
  assert.equal(identity.session_user, "desk_app");
  assert.equal(identity.current_user, "desk_app");
  assert.notEqual(migrationIdentity.session_user, identity.session_user);
  assert.equal(identity.database, migrationIdentity.database);
  for (const flag of [
    "rolsuper",
    "rolcreatedb",
    "rolcreaterole",
    "rolbypassrls",
    "rolinherit",
  ])
    assert.equal(
      identity[flag],
      false,
      `Runtime role unexpectedly has ${flag}`,
    );
  checked.push("Runtime authenticates as a distinct restricted desk_app role");

  const memberships =
    await app.query(`SELECT parent.rolname FROM pg_auth_members m
    JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
    WHERE child.rolname=session_user`);
  assert.equal(
    memberships.rowCount,
    0,
    "Runtime must not be able to SET ROLE to another role",
  );
  const ownedTables = await app.query(`SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tableowner=session_user`);
  assert.equal(ownedTables.rowCount, 0);
  checked.push("Runtime has no inherited roles or owned application tables");

  const grants = (
    await app.query(`SELECT
    (SELECT bool_and(has_table_privilege(current_user,'public.requests',p)) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p) AS requests,
    (SELECT bool_and(has_table_privilege(current_user,'public.audit_events',p)) FROM unnest(ARRAY['SELECT','INSERT']) p) AS audit,
    has_function_privilege(current_user,'public.purge_expired_demo_workspaces()','EXECUTE') AS cleanup,
    has_schema_privilege(current_user,'public','CREATE') AS schema_create`)
  ).rows[0];
  assert.equal(grants.requests, true);
  assert.equal(grants.audit, true);
  assert.equal(grants.cleanup, true);
  assert.equal(grants.schema_create, false);
  checked.push(
    "Application CRUD and bounded cleanup available; schema creation denied",
  );
  const commandRoutine = (
    await app.query(`SELECT p.prosecdef,
    has_function_privilege(current_user,p.oid,'EXECUTE') AS executable
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='apply_request_command'`)
  ).rows;
  assert.equal(commandRoutine.length, 1);
  assert.equal(commandRoutine[0].prosecdef, false);
  assert.equal(commandRoutine[0].executable, true);
  checked.push(
    "Atomic command function runs with caller privileges, without owner elevation",
  );

  for (const sql of [
    "UPDATE public.audit_events SET action=action WHERE false",
    "DELETE FROM public.audit_events WHERE false",
    "TRUNCATE public.audit_events",
    "UPDATE public.workspaces SET expires_at=expires_at WHERE false",
    "DELETE FROM public.workspaces WHERE false",
    "SELECT * FROM public._prisma_migrations LIMIT 0",
  ]) {
    await app.query("BEGIN");
    let denied = false;
    try {
      await app.query(sql);
    } catch (error) {
      denied = (error as { code?: string }).code === "42501";
    } finally {
      await app.query("ROLLBACK");
    }
    assert.equal(denied, true, `Expected PostgreSQL permission denial: ${sql}`);
  }
  checked.push(
    "Audit mutation, workspace expiry manipulation and migration metadata access denied by PostgreSQL",
  );
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/database-access.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        status: "passed",
        host: new URL(appUrl).hostname,
        runtimeRole: identity.session_user,
        migrationRole: migrationIdentity.session_user,
        checked,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ status: "passed", checks: checked }));
} catch (error) {
  console.error(
    "Database access verification failed:",
    error instanceof assert.AssertionError
      ? error.message
      : { code: (error as { code?: string }).code ?? "connection_error" },
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled([app.end(), owner.end()]);
}
