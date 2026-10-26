import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const origin = process.env.PUBLIC_DEMO_ORIGIN;
if (
  origin !== "https://operations-workflows-staging.vanya-matyushkin.workers.dev"
)
  throw Error("This bounded test is staging-only.");
const demo = await fetch(origin + "/api/demo", {
  method: "POST",
  headers: { origin },
});
assert.equal(demo.status, 200);
const session = await demo.json();
const cookie = demo.headers.get("set-cookie")!.split(";")[0];
let csrf = session.csrfToken;
const version = demo.headers.get("x-deployment-version");
let requests = 1;
async function call(path: string, body?: unknown, key = crypto.randomUUID()) {
  const r = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      origin: origin!,
      cookie,
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  requests++;
  assert.equal(r.headers.get("x-deployment-version"), version);
  assert.equal(r.headers.get("cache-control"), "no-store");
  return { status: r.status, body: await r.json() };
}
const manager = session.organizations[0].members.find(
  (m: { role: string }) => m.role === "MANAGER",
);
const switched = await call("/api/session/switch", { memberId: manager.id });
assert.equal(switched.status, 200);
csrf = switched.body.csrfToken;
const input = {
  action: "hold",
  resource: "bike-01",
  start: new Date(Date.now() + 3600000).toISOString(),
  end: new Date(Date.now() + 7200000).toISOString(),
};
const competing = await Promise.all([
  call("/api/booking", input),
  call("/api/booking", input),
]);
assert.deepEqual(competing.map((x) => x.status).sort(), [200, 409]);
assert.equal(
  competing.find((x) => x.status === 409)!.body.error.code,
  "RESOURCE_UNAVAILABLE",
);
const key = crypto.randomUUID(),
  second = { ...input, resource: "desk-01" };
const replay = await Promise.all([
  call("/api/booking", second, key),
  call("/api/booking", second, key),
]);
assert.ok(replay.every((x) => x.status === 200));
assert.deepEqual(replay[0].body, replay[1].body);
assert.equal(
  (await call("/api/booking", { ...second, resource: "room-01" }, key)).body
    .error.code,
  "IDEMPOTENCY_MISMATCH",
);
const csv =
  "id,name,email,category,status\n" +
  Array.from(
    { length: 50 },
    (_, i) =>
      `M${String(i + 1).padStart(3, "0")},Demo Member ${i + 1},member${i + 1}@example.invalid,regular,active`,
  ).join("\n");
const preview = await call("/api/association", { action: "preview", csv });
assert.equal(preview.status, 200);
const state = await call("/api/association");
const plan = state.body.plans[0];
const apply = {
    action: "apply",
    plan: plan.id,
    digest: plan.digest,
    rows: Array.from({ length: 50 }, (_, i) => i + 2),
  },
  applyKey = crypto.randomUUID();
const imports = await Promise.all([
  call("/api/association", apply, applyKey),
  call("/api/association", apply, applyKey),
]);
assert.ok(imports.every((x) => x.status === 200));
assert.deepEqual(imports[0].body, imports[1].body);
const imported = await call("/api/association");
assert.equal(imported.body.members.length, 50);
assert.equal(imported.body.revision, 2);
assert.equal(
  (await call("/api/association", { action: "charges", period: "2026-10" }))
    .status,
  200,
);
const payments =
  "id,reference,cents\n" +
  Array.from(
    { length: 50 },
    (_, i) =>
      `BANK${String(i + 1).padStart(3, "0")},M${String(i + 1).padStart(3, "0")},12000`,
  ).join("\n");
assert.equal(
  (await call("/api/association", { action: "payments", csv: payments }))
    .status,
  200,
);
assert.equal(
  (await call("/api/association", { action: "reconcile" })).status,
  200,
);
assert.equal(
  (
    await call("/api/association", {
      action: "document",
      member: "M001",
      kind: "notice",
      language: "de",
    })
  ).status,
  200,
);
const final = await call("/api/association");
assert.equal(final.body.allocations.length, 50);
assert.equal((await call("/api/booking")).body.bookings.length, 2);
// Exercise the accepted maximum of 20 retained 50-row import plans.
for (let i = 1; i < 20; i++)
  assert.equal(
    (await call("/api/association", { action: "preview", csv })).status,
    200,
  );
const maximum = await call("/api/association");
assert.equal(maximum.body.plans.length, 20);
assert.equal(
  (await call("/api/association", { action: "preview", csv })).status,
  429,
);
const result = {
  at: new Date().toISOString(),
  origin,
  version,
  requests,
  status: "passed",
  checks: [
    "competing holds: exactly one winner",
    "same-key concurrent booking returns identical receipt",
    "changed payload is rejected",
    "50-row CSV apply race commits once",
    "50 charges/payments reconciled with document generation",
    "20 retained 50-row plans and rejection of the 21st",
    "read-after-write and no-store on every response",
  ],
};
await writeFile(
  ".local/cpu-hosted-concurrency.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
