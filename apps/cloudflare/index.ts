import { connectEdgeDatabase as connectDatabase } from "../../packages/core/edge-db.js";
import { handleApi } from "../../packages/core/http.js";

import {
  CreateRequest,
  EditRequest,
  Decision,
  SubmitRequest,
  SwitchIdentity,
  ListQuery,
  RequestRecord,
  Replay,
} from "../../packages/contracts/index.js";
// Zod compiles object validators lazily. Compile them during isolate startup,
// outside the first visitor's CPU budget; no request state or I/O is retained.
for (const schema of [
  CreateRequest,
  EditRequest,
  Decision,
  SubmitRequest,
  SwitchIdentity,
  ListQuery,
  RequestRecord,
  Replay,
])
  schema.safeParse({});

function unavailable(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message, requestId: crypto.randomUUID() } },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const key = request.headers.get("CF-Connecting-IP") ?? "local";
    if (!(await env.API_LIMIT.limit({ key })).success)
      return unavailable(
        429,
        "RATE_LIMITED",
        "Please wait a minute before retrying.",
      );
    if (
      url.pathname === "/api/demo" &&
      !(await env.DEMO_LIMIT.limit({ key })).success
    )
      return unavailable(
        429,
        "RATE_LIMITED",
        "Please wait before starting another demo.",
      );
    const db = connectDatabase(env.HYPERDRIVE.connectionString, 1);
    try {
      const response = await handleApi(request, {
        db,
        origin: env.APP_ORIGIN,
        backgroundMode: "disabled",
        demoDailyLimit: Number(env.DEMO_DAILY_LIMIT),
        log: (entry) => console.log(JSON.stringify(entry)),
      });
      response.headers.set("x-deployment-version", env.VERSION.id);
      return response;
    } catch {
      console.error(JSON.stringify({ event: "api_unavailable" }));
      return unavailable(
        503,
        "SERVICE_UNAVAILABLE",
        "The demo is temporarily unavailable. The engineering proof remains accessible.",
      );
    } finally {
      ctx.waitUntil(db.$disconnect());
    }
  },
  async scheduled(_event, env, ctx) {
    const db = connectDatabase(env.HYPERDRIVE.connectionString, 1);
    try {
      await db.$queryRaw`SELECT public.purge_expired_demo_workspaces()`;
    } finally {
      ctx.waitUntil(db.$disconnect());
    }
  },
} satisfies ExportedHandler<Env>;
