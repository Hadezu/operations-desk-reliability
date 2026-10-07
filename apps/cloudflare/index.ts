import { connectDatabase } from "../../packages/core/db.js";
import { handleApi } from "../../packages/core/http.js";

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
      return await handleApi(request, {
        db,
        origin: env.APP_ORIGIN,
        backgroundMode: "disabled",
        demoDailyLimit: Number(env.DEMO_DAILY_LIMIT),
        log: (entry) => console.log(JSON.stringify(entry)),
      });
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
