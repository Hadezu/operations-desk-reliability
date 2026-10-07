import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { sourceHash } from "./source.js";

assert.equal(
  process.env.GITHUB_ACTIONS,
  "true",
  "Merge only inside the completed CI workflow",
);
assert.equal(process.env.INTEGRATION_JOB_RESULT, "success");
assert.equal(process.env.CONTAINER_JOB_RESULT, "success");
const ciUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const manifest = JSON.parse(
  await readFile(".local/ci/integration/evidence/manifest.json", "utf8"),
);
const browser = JSON.parse(
  await readFile(".local/ci/containers/evidence/playwright.json", "utf8"),
);
const access = JSON.parse(
  await readFile(".local/ci/integration/evidence/database-access.json", "utf8"),
);
assert.equal(manifest.commit, process.env.GITHUB_SHA);
assert.equal(manifest.sourceHash, await sourceHash());
assert.equal(manifest.ciUrl, ciUrl);
assert.equal(manifest.dirty, false);
assert.ok(manifest.checks.length >= 29);
assert.ok(
  manifest.checks.every((c: { status: string }) => c.status !== "failed"),
);
assert.equal(browser.config.metadata.expectsWorkerReport, true);
assert.equal(browser.stats.expected, 2);
for (const field of ["unexpected", "flaky", "skipped"])
  assert.equal(browser.stats[field], 0);
assert.deepEqual(browser.errors, []);
assert.equal(access.status, "passed");
assert.equal(access.runtimeRole, "desk_app");
const check = manifest.checks.find(
  (c: { name: string }) => c.name === "Docker Compose execution",
);
assert.ok(check);
Object.assign(check, {
  status: "passed",
  observed:
    "GitHub containers job built images, bootstrapped a clean PostgreSQL database and passed desktop/mobile approval journeys, including a persisted report from the real BullMQ worker.",
  source: ".github/workflows/verify.yml",
  durationMs: browser.stats.duration,
});
manifest.checks.push({
  name: "Restricted database credentials",
  status: "passed",
  expected:
    "Application authenticates separately and PostgreSQL denies audit mutation and schema administration.",
  observed: access.checked.join("; "),
  source: "scripts/verify-database-access.ts",
});
manifest.assembledAt = new Date().toISOString();
await mkdir("evidence", { recursive: true });
await writeFile(
  "evidence/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`Release proof assembled from successful jobs: ${ciUrl}`);
