import "dotenv/config";
import pg from "pg";

export async function provisionRole(ownerUrl: string, appUrl: string) {
  const target = new URL(appUrl);
  const name = decodeURIComponent(target.username);
  if (name !== "desk_app")
    throw new Error("Use a dedicated desk_app runtime role.");
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname=$1",
      [name],
    );
    if (!rows.length)
      await client.query(
        "CREATE ROLE desk_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT",
      );
    await client.query(
      `ALTER ROLE desk_app PASSWORD ${pg.escapeLiteral(decodeURIComponent(target.password))}`,
    );
    await client.query("GRANT USAGE ON SCHEMA public TO desk_app");
    await client.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO desk_app",
    );
    await client.query("REVOKE ALL ON _prisma_migrations FROM desk_app");
    await client.query(
      "REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM desk_app",
    );
    await client.query("REVOKE UPDATE, DELETE ON workspaces FROM desk_app");
    await client.query(
      "GRANT EXECUTE ON FUNCTION public.purge_expired_demo_workspaces() TO desk_app",
    );
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  } finally {
    await client.end();
  }
}
if (process.argv[1]?.endsWith("provision-role.ts")) {
  if (!process.env.MIGRATION_DATABASE_URL || !process.env.DATABASE_URL)
    throw new Error("Both database URLs are required.");
  await provisionRole(
    process.env.MIGRATION_DATABASE_URL,
    process.env.DATABASE_URL,
  );
  console.log("Runtime role provisioned; audit history is insert/read only.");
}
