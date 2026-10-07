import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { sourceHash } from "./source.js";

// Run only after the public smoke and browser journeys, while wrangler tail
// captures that deployment. Publish aggregates, never cookies or raw tail data.
const tailPath = process.argv[2];
assert.ok(tailPath, "Supply the ignored wrangler tail JSON capture path");
const smoke = JSON.parse(await readFile("evidence/public-smoke.json", "utf8"));
const browser = JSON.parse(await readFile("evidence/playwright.json", "utf8"));
const access = JSON.parse(
  await readFile("evidence/database-access.json", "utf8"),
);
const fingerprint = await sourceHash();
assert.equal(smoke.status, "passed");
assert.equal(smoke.sourceHash, fingerprint);
assert.equal(browser.config.metadata.origin, smoke.origin);
assert.equal(browser.stats.expected, 2);
for (const field of ["unexpected", "flaky", "skipped"])
  assert.equal(browser.stats[field], 0);
assert.deepEqual(browser.errors, []);
assert.equal(access.status, "passed");
assert.equal(access.runtimeRole, "desk_app");
assert.match(access.host, /\.neon\.tech$/);
const text = await readFile(tailPath, "utf8");
const events = (text.match(/\{[\s\S]*?\n\}/g) ?? [])
  .map((value) => JSON.parse(value))
  .filter(
    (event) =>
      event.scriptVersion?.id === smoke.deploymentVersion &&
      event.event?.request &&
      new URL(event.event.request.url).pathname.startsWith("/api/"),
  );
assert.ok(events.length >= 30, "Capture at least 30 API invocations");
assert.ok(
  events.every((e) => e.outcome === "ok" && e.exceptions.length === 0),
  "Cloudflare must report no invocation errors",
);
const cpu = events.map((e) => e.cpuTime as number).sort((a, b) => a - b);
assert.ok(cpu.every((n) => Number.isFinite(n) && n >= 0));
const p95 = cpu[Math.ceil(cpu.length * 0.95) - 1];
assert.ok(p95 <= 10, `CPU p95 ${p95} ms exceeds the Free target`);
const artifact = {
  generatedAt: new Date().toISOString(),
  sourceHash: fingerprint,
  origin: smoke.origin,
  testedVersion: smoke.deploymentVersion,
  status: "passed",
  smoke,
  browser: {
    passed: browser.stats.expected,
    durationMs: browser.stats.duration,
    origin: browser.config.metadata.origin,
  },
  database: access,
  cpu: {
    samples: cpu.length,
    p50Ms: cpu[Math.floor(cpu.length / 2)],
    p95Ms: p95,
    maxMs: cpu.at(-1),
    outcomes: "all ok",
    valuesMs: cpu,
  },
  limitation:
    "Small synthetic sample, not a load test or uptime guarantee. Free service quotas still apply. Evidence-only asset rebuilds may have a different version with the same source hash.",
};
await writeFile(
  "evidence/deployment.json",
  JSON.stringify(artifact, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    status: artifact.status,
    origin: artifact.origin,
    version: artifact.testedVersion,
    cpu: artifact.cpu,
  }),
);
