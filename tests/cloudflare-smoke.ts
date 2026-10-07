import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unstable_dev, experimental_readRawConfig } from "wrangler";
if (!process.env.DATABASE_URL) throw Error("Real PostgreSQL required.");
// Isolate local Wrangler configuration so migration credentials from .env are
// never loaded as Worker secrets, and the smoke origin cannot drift.
const origin = "http://127.0.0.1:8799";
const { rawConfig: config } = experimental_readRawConfig({
  config: "wrangler.jsonc",
});
config.main = resolve("apps/cloudflare/index.ts");
config.assets!.directory = resolve("apps/web/out");
config.alias!["#prisma-client"] = resolve(".generated/prisma-edge/client.ts");
config.vars = { APP_ORIGIN: origin, DEMO_DAILY_LIMIT: "10000" };
config.hyperdrive![0].localConnectionString = process.env.DATABASE_URL;
delete config.$schema;
await mkdir(".local/cloudflare-smoke", { recursive: true });
// An explicit dev-vars file also blocks Wrangler's process.env fallback when
// required secrets are declared. CI's Fastify APP_ORIGIN must not override this
// isolated workerd origin; this test always uses the local PostgreSQL binding.
await writeFile(".local/cloudflare-smoke/.dev.vars", 'NEON_DATABASE_URL=""\n');
await writeFile(
  ".local/cloudflare-smoke/wrangler.json",
  JSON.stringify(config),
);
const worker = await unstable_dev("apps/cloudflare/index.ts", {
  config: ".local/cloudflare-smoke/wrangler.json",
  ip: "127.0.0.1",
  port: 8799,
  local: true,
  logLevel: "error",
  experimental: {
    disableExperimentalWarning: true,
    watch: false,
    disableDevRegistry: true,
  },
});
const started = Date.now();
try {
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  const demo = await fetch(`${origin}/api/demo`, {
    method: "POST",
    headers: { origin },
  });
  assert.equal(demo.status, 200, await demo.clone().text());
  const session = await demo.json();
  const cookie = demo.headers.get("set-cookie")!.split(";")[0];
  let csrf: string = session.csrfToken;
  async function call(path: string, method = "GET", payload?: unknown) {
    return fetch(`${origin}${path}`, {
      method,
      headers: {
        origin,
        cookie,
        "content-type": "application/json",
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }
  const creation = await call("/api/requests", "POST", {
    title: "Cloudflare smoke request",
    description: "Real workerd and PostgreSQL verification.",
    category: "SOFTWARE",
    amountCents: 3900,
  });
  assert.equal(creation.status, 200);
  const record = await creation.json();
  assert.equal(
    (await call(`/api/requests/${record.id}/submit`, "POST", { version: 1 }))
      .status,
    200,
  );
  assert.equal(
    (
      await call(`/api/requests/${record.id}/decision`, "POST", {
        version: 2,
        decision: "APPROVED",
        comment: "Not authorized",
      })
    ).status,
    403,
  );
  const org = session.organizations.find(
    (o: { id: string }) => o.id === session.identity.organizationId,
  );
  const member = org.members.find(
    (m: { role: string }) => m.role === "MANAGER",
  );
  const changed = await call("/api/session/switch", "POST", {
    memberId: member.id,
  });
  assert.equal(changed.status, 200);
  csrf = (await changed.json()).csrfToken;
  assert.equal(
    (
      await call(`/api/requests/${record.id}/decision`, "POST", {
        version: 2,
        decision: "APPROVED",
        comment: "Approved in workerd.",
      })
    ).status,
    200,
  );
  const report = await (await call(`/api/requests/${record.id}/report`)).json();
  assert.equal(report.mode, "disabled");
  assert.equal(report.event, null);
  assert.equal(report.report, null);
  assert.equal((await fetch(`${origin}/proof/`)).status, 200);
  await writeFile(
    "evidence/cloudflare-local.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        status: "passed",
        observed:
          "Local workerd + real PostgreSQL: bootstrap, create, submit, denied employee decision, manager approval, no orphan outbox, static proof page.",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS Cloudflare local runtime with real PostgreSQL. Production CPU remains unverified.",
  );
} finally {
  await worker.stop();
}
