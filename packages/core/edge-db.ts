import postgres from "postgres";
import type { Database, DatabaseSession } from "./db.js";

// A deliberately bounded SQL adapter for the shared HTTP operations. Prisma
// remains the Node/worker client and migration tool. Avoiding its query compiler
// in each edge request leaves room within Workers Free's 10 ms CPU allowance.
// Identifiers come only from this schema; all values are PostgreSQL parameters.
const schema = {
  workspace: ["workspaces", "id createdAt expiresAt"],
  organization: ["organizations", "id workspaceId name"],
  member: ["members", "id organizationId name role"],
  session: ["sessions", "tokenHash workspaceId memberId csrfToken expiresAt"],
  request: [
    "requests",
    "id organizationId ownerId title description category amountCents status version decisionComment createdAt updatedAt",
  ],
  auditEvent: [
    "audit_events",
    "id organizationId actorId entityId action correlationId metadata createdAt",
  ],
  command: [
    "commands",
    "id organizationId actorId operation key fingerprint result createdAt",
  ],
  outboxEvent: [
    "outbox_events",
    "id organizationId requestId correlationId status leaseUntil leaseToken publishedAt replayGeneration createdAt",
  ],
  report: ["reports", "id organizationId requestId outboxId content createdAt"],
  jobAttempt: [
    "job_attempts",
    "id outboxId generation attempt status errorCode startedAt finishedAt",
  ],
} as const;
type Model = keyof typeof schema;
type ObjectValue = Record<string, unknown>;
type Query = (
  sql: string,
  values?: unknown[],
) => Promise<{ rows: ObjectValue[]; rowCount: number }>;
const object = (value: unknown): ObjectValue => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof Date
  )
    throw Error("Unsupported edge adapter expression");
  return value as ObjectValue;
};
const snake = (key: string) =>
  key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
function column(model: Model, key: string) {
  if (!schema[model][1].split(" ").includes(key))
    throw Error("Unknown edge adapter field");
  return `"${snake(key)}"`;
}
function decode(row: ObjectValue) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value,
    ]),
  );
}
function session(query: Query) {
  function model(name: Model) {
    const table = `"${schema[name][0]}"`;
    function where(input: unknown, values: unknown[]): string {
      const fields = object(input ?? {});
      const bind = (v: unknown) => {
        values.push(v);
        return `$${values.length}`;
      };
      const terms: string[] = [];
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        if (key === "OR") {
          if (!Array.isArray(value)) throw Error("Invalid OR");
          terms.push(
            `(${value.map((v) => `(${where(v, values)})`).join(" OR ") || "FALSE"})`,
          );
        } else if (key === "organization" && name === "member") {
          const relation = object(value);
          if (Object.keys(relation).join() !== "workspaceId")
            throw Error("Unsupported relation");
          terms.push(
            `organization_id IN (SELECT id FROM organizations WHERE workspace_id=${bind(relation.workspaceId)})`,
          );
        } else if (
          key === "organizationId_actorId_operation_key" &&
          name === "command"
        ) {
          terms.push(`(${where(value, values)})`);
        } else {
          const col = column(name, key);
          if (value === null) terms.push(`${col} IS NULL`);
          else if (typeof value === "object" && !(value instanceof Date)) {
            for (const [op, operand] of Object.entries(object(value))) {
              const operators: Record<string, string> = { lt: "<", gte: ">=" };
              if (!operators[op]) throw Error("Unsupported predicate");
              terms.push(`${col}${operators[op]}${bind(operand)}`);
            }
          } else terms.push(`${col}=${bind(value)}`);
        }
      }
      return terms.join(" AND ") || "TRUE";
    }
    async function find(args: ObjectValue = {}, first = false) {
      for (const key of Object.keys(args))
        if (!["where", "orderBy", "take", "include"].includes(key))
          throw Error("Unsupported find option");
      const values: unknown[] = [];
      let sql = `SELECT * FROM ${table} WHERE ${where(args.where, values)}`;
      if (args.orderBy) {
        const order = Array.isArray(args.orderBy)
          ? args.orderBy
          : [args.orderBy];
        sql +=
          " ORDER BY " +
          order
            .flatMap((o) =>
              Object.entries(object(o)).map(([key, dir]) => {
                if (dir !== "asc" && dir !== "desc")
                  throw Error("Unsupported sort direction");
                return `${column(name, key)} ${dir}`;
              }),
            )
            .join(",");
      }
      if (first || args.take !== undefined) {
        const limit = first ? 1 : args.take;
        if (
          typeof limit !== "number" ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 201
        )
          throw Error("Invalid limit");
        values.push(limit);
        sql += ` LIMIT $${values.length}`;
      }
      const rows = (await query(sql, values)).rows.map(decode);
      if (args.include) {
        const include = object(args.include);
        if (
          name === "session" &&
          Object.keys(include).join() === "workspace" &&
          include.workspace === true
        ) {
          for (const row of rows)
            row.workspace = await model("workspace").findFirst({
              where: { id: row.workspaceId },
            });
        } else if (
          name === "organization" &&
          Object.keys(include).join() === "members"
        ) {
          const options = object(include.members);
          if (JSON.stringify(options) !== '{"orderBy":{"role":"asc"}}')
            throw Error("Unsupported members include");
          for (const row of rows)
            row.members = await model("member").findMany({
              where: { organizationId: row.id },
              orderBy: { role: "asc" },
            });
        } else throw Error("Unsupported include");
      }
      return rows;
    }
    async function create({ data }: { data: ObjectValue }) {
      const row = {
        ...(name === "session" ? {} : { id: crypto.randomUUID() }),
        ...data,
      };
      const entries = Object.entries(row).filter(([, v]) => v !== undefined);
      const result = await query(
        `INSERT INTO ${table} (${entries.map(([k]) => column(name, k)).join(",")}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
        entries.map(([, v]) => v),
      );
      return decode(result.rows[0]);
    }
    async function update(args: { where: unknown; data: ObjectValue }) {
      const values: unknown[] = [];
      const sets = Object.entries(args.data)
        .filter(([, v]) => v !== undefined)
        .map(([key, value]) => {
          const col = column(name, key);
          if (
            value &&
            typeof value === "object" &&
            !(value instanceof Date) &&
            key === "version"
          ) {
            const increment = object(value);
            if (
              Object.keys(increment).join() !== "increment" ||
              !Number.isSafeInteger(increment.increment)
            )
              throw Error("Unsupported increment");
            values.push(increment.increment);
            return `${col}=${col}+$${values.length}`;
          }
          values.push(value);
          return `${col}=$${values.length}`;
        });
      if (!sets.length) throw Error("Empty update");
      return query(
        `UPDATE ${table} SET ${sets.join(",")} WHERE ${where(args.where, values)} RETURNING *`,
        values,
      );
    }
    async function remove({ where: filter }: { where: unknown }) {
      const values: unknown[] = [];
      return query(
        `DELETE FROM ${table} WHERE ${where(filter, values)} RETURNING *`,
        values,
      );
    }
    const first = async (args: ObjectValue) =>
      (await find(args, true))[0] ?? null;
    const required = async (args: ObjectValue) => {
      const row = await first(args);
      if (!row) throw Error("Record not found");
      return row;
    };
    return {
      findMany: find,
      findFirst: first,
      findUnique: first,
      findFirstOrThrow: required,
      findUniqueOrThrow: required,
      create,
      async createMany({ data }: { data: ObjectValue[] }) {
        for (const row of data) await create({ data: row });
        return { count: data.length };
      },
      async count(args: ObjectValue = {}) {
        const values: unknown[] = [];
        return Number(
          (
            await query(
              `SELECT count(*) FROM ${table} WHERE ${where(args.where, values)}`,
              values,
            )
          ).rows[0].count,
        );
      },
      async update(args: { where: unknown; data: ObjectValue }) {
        const result = await update(args);
        if (result.rowCount !== 1) throw Error("Record not found");
        return decode(result.rows[0]);
      },
      async updateMany(args: { where: unknown; data: ObjectValue }) {
        return { count: (await update(args)).rowCount };
      },
      async delete(args: { where: unknown }) {
        const result = await remove(args);
        if (result.rowCount !== 1) throw Error("Record not found");
        return decode(result.rows[0]);
      },
      async deleteMany(args: { where: unknown }) {
        return { count: (await remove(args)).rowCount };
      },
    };
  }
  function raw(strings: TemplateStringsArray, values: unknown[]) {
    if (!Array.isArray(strings.raw))
      throw Error("Only tagged SQL templates are accepted");
    return query(
      strings.reduce(
        (sql, fragment, i) => sql + (i ? `$${i}` : "") + fragment,
        "",
      ),
      values,
    );
  }
  // This is a subset of the generated Prisma surface, not a general ORM.
  // Unsupported query shapes throw. The shared API assertion suite runs against
  // both adapters; inspecting and recovery code continues to use real Prisma.
  return {
    ...Object.fromEntries(
      (Object.keys(schema) as Model[]).map((name) => [name, model(name)]),
    ),
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      return (await raw(strings, values)).rows;
    },
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      return (await raw(strings, values)).rowCount ?? 0;
    },
  } as unknown as DatabaseSession;
}

export function connectEdgeDatabase(
  connectionString: string,
  max = 1,
): Database {
  const sql = postgres(connectionString, {
    max,
    connect_timeout: 10,
    idle_timeout: 1,
    fetch_types: false,
    prepare: true,
    types: {
      // The shared tagged SQL passes JSON as pre-serialized text, as Prisma
      // requires. Keep that representation when the server infers jsonb.
      json: {
        to: 3802,
        from: [114, 3802],
        serialize: (value: unknown) =>
          typeof value === "string" ? value : JSON.stringify(value),
        parse: JSON.parse,
      },
    },
  });
  function queryFor(client: typeof sql | postgres.TransactionSql): Query {
    return async (text, values = []) => {
      const parameters = values.map((value) =>
        value !== null && typeof value === "object" && !(value instanceof Date)
          ? JSON.stringify(value)
          : value,
      );
      const result = await client.unsafe(text, parameters as never[], {
        prepare: true,
      });
      return {
        rows: Array.from(result) as ObjectValue[],
        rowCount: result.count,
      };
    };
  }
  return {
    ...session(queryFor(sql)),
    async $connect() {
      await sql`SELECT 1`;
    },
    async $disconnect() {
      await sql.end({ timeout: 5 });
    },
    async $transaction<T>(
      run: (tx: DatabaseSession) => Promise<T>,
      options?: { timeout?: number; maxWait?: number },
    ): Promise<T> {
      const result = await sql.begin(async (client) => {
        const query = queryFor(client);
        await query(
          "SELECT set_config('statement_timeout', $1, true), set_config('idle_in_transaction_session_timeout', $1, true)",
          [String(options?.timeout ?? 15000)],
        );
        return await run(session(query));
      });
      return result as T;
    },
  };
}
