import { neon } from "@neondatabase/serverless";
import { databaseSession } from "./edge-db.js";
import type { Database } from "./db.js";

// Stateless HTTPS is cheaper in the edge CPU budget than a JS TCP protocol.
// Each mutating command is one PostgreSQL statement/function, hence atomic.
// Never split an interactive transaction into independent HTTP requests.
export function connectHttpDatabase(connectionString: string): Database {
  const sql = neon(connectionString, { fullResults: true });
  return {
    ...databaseSession(async (text, values = []) => {
      const result = await sql.query(text, values, { fullResults: true });
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    }),
    async $connect() {
      await sql`SELECT 1`;
    },
    async $disconnect() {
      /* HTTPS has no persistent client session. */
    },
    async $transaction() {
      throw Error(
        "Interactive transactions require the full Node/TCP environment; public commands use atomic SQL functions.",
      );
    },
  };
}
