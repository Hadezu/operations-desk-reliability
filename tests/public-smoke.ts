import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { sourceHash } from "../scripts/source.js";

const configuredOrigin = process.env.PUBLIC_DEMO_ORIGIN;
if (!configuredOrigin || new URL(configuredOrigin).protocol !== "https:")
  throw Error("Set PUBLIC_DEMO_ORIGIN to the deployed HTTPS application.");
const origin: string = configuredOrigin;
const started = Date.now();
const checks: string[] = [];
const health = await fetch(`${origin}/api/health`);
assert.equal(health.status, 200);
const deploymentVersion = health.headers.get("x-deployment-version");
assert.ok(deploymentVersion, "Worker must identify the verified deployment");
const demo = await fetch(`${origin}/api/demo`, {
  method: "POST",
  headers: { origin },
});
assert.equal(demo.status, 200, "Public demo bootstrap");
assert.equal(demo.headers.get("x-deployment-version"), deploymentVersion);
const session = await demo.json();
const setCookie = demo.headers.get("set-cookie")!;
assert.match(setCookie, /HttpOnly/i);
assert.match(setCookie, /Secure/i);
const cookie = setCookie.split(";")[0];
let csrf: string = session.csrfToken;
checks.push("HTTPS API and secure opaque session");
async function call(
  path: string,
  method = "GET",
  payload?: unknown,
  key = crypto.randomUUID(),
  token = csrf,
) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      origin,
      cookie,
      "content-type": "application/json",
      "x-csrf-token": token,
      "idempotency-key": key,
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  assert.equal(response.headers.get("x-deployment-version"), deploymentVersion);
  return response;
}
const input = {
  title: "Public deployment verification",
  description: "Synthetic record used to verify the hosted approval flow.",
  category: "SOFTWARE",
  amountCents: 3900,
};
const key = crypto.randomUUID();
const created = await call("/api/requests", "POST", input, key);
assert.equal(created.status, 200);
const record = await created.json();
const repeated = await call("/api/requests", "POST", input, key);
assert.equal(repeated.status, 200);
assert.equal((await repeated.json()).id, record.id);
assert.equal(
  (
    await call(
      "/api/requests",
      "POST",
      { ...input, title: "Changed payload" },
      key,
    )
  ).status,
  409,
);
assert.equal(
  (
    await call(
      `/api/requests/${record.id}/submit`,
      "POST",
      { version: 1 },
      crypto.randomUUID(),
      "invalid-csrf",
    )
  ).status,
  403,
);
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
      comment: "Unauthorized",
    })
  ).status,
  403,
);
checks.push(
  "Idempotent replay, conflicting payload rejection, CSRF and employee authorization",
);
const org = session.organizations.find(
  (o: { id: string }) => o.id === session.identity.organizationId,
);
async function switchTo(memberId: string) {
  const res = await call("/api/session/switch", "POST", { memberId });
  assert.equal(res.status, 200);
  csrf = (await res.json()).csrfToken;
}
await switchTo(
  org.members.find((m: { role: string }) => m.role === "MANAGER").id,
);
assert.equal(
  (
    await call(`/api/requests/${record.id}/decision`, "POST", {
      version: 2,
      decision: "APPROVED",
      comment: "Verified on the deployed Cloudflare API.",
    })
  ).status,
  200,
);
assert.equal(
  (await (await call(`/api/requests/${record.id}`)).json()).status,
  "APPROVED",
);
const audit = (await (await call(`/api/requests/${record.id}/audit`)).json())
  .items;
assert.equal(
  audit.filter((a: { action: string }) => a.action === "REQUEST_CREATED")
    .length,
  1,
);
const report = await (await call(`/api/requests/${record.id}/report`)).json();
assert.equal(report.mode, "disabled");
assert.equal(report.event, null);
assert.equal(report.report, null);
checks.push(
  "Persisted manager approval, one creation audit and no absent-worker jobs",
);
await switchTo(
  org.members.find((m: { role: string }) => m.role === "OBSERVER").id,
);
assert.equal((await call("/api/requests", "POST", input)).status, 403);
const otherOrg = session.organizations.find(
  (o: { id: string }) => o.id !== org.id,
);
await switchTo(otherOrg.members[0].id);
assert.equal((await call(`/api/requests/${record.id}`)).status, 404);
assert.equal((await call("/api/session", "DELETE")).status, 200);
assert.equal((await call("/api/session")).status, 401);
checks.push(
  "Observer write denial, cross-tenant denial and session revocation",
);
assert.equal((await fetch(`${origin}/proof/`)).status, 200);
checks.push("Static evidence page available independently of the API");
await mkdir("evidence", { recursive: true });
await writeFile(
  "evidence/public-smoke.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      origin,
      deploymentVersion,
      status: "passed",
      sourceHash: await sourceHash(),
      durationMs: Date.now() - started,
      checks,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ status: "passed", origin, checks }));
