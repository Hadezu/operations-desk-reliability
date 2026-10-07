import "dotenv/config";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { sourceHash } from "./source.js";
import { connectDatabase } from "../packages/core/db.js";

type Check = {
  name: string;
  status: "passed" | "failed" | "unverified";
  expected: string;
  observed: string;
  source: string;
  durationMs?: number;
};
const checks: Check[] = [];
const started = Date.now();
const hash = await sourceHash();
await mkdir("evidence", { recursive: true });
const steps = [
  [
    "TypeScript",
    "Node and web strict type checks pass",
    "tsconfig.json",
    "node_modules/typescript/bin/tsc",
    ["--noEmit"],
  ],
  [
    "Cloudflare types",
    "Edge client and generated bindings type check",
    "apps/cloudflare/tsconfig.json",
    "node_modules/typescript/bin/tsc",
    ["--noEmit", "-p", "apps/cloudflare/tsconfig.json"],
  ],
  [
    "API and database guarantees",
    "Tenant, role, CSRF, idempotency, concurrency, rollback and SQL privilege checks pass",
    "tests/api.test.ts",
    "node_modules/vitest/vitest.mjs",
    ["run"],
  ],
  [
    "Recovery scenarios",
    "Real PostgreSQL + Redis: restart, retries, replay, deduplication and reconciliation pass",
    "tests/worker-recovery.ts",
    "node_modules/tsx/dist/cli.mjs",
    ["tests/worker-recovery.ts"],
  ],
  [
    "Next.js production build",
    "Static export compiles and type checks",
    "apps/web/next.config.mjs",
    "node_modules/next/dist/bin/next",
    ["build", "apps/web", "--webpack"],
  ],
  [
    "Browser workflow",
    "Employee → manager → observer journey passes on desktop and mobile",
    "tests/browser/journey.spec.ts",
    "node_modules/@playwright/test/cli.js",
    ["test"],
  ],
  [
    "Cloudflare bundle",
    "Worker and static assets produce a deployment bundle without publishing",
    "wrangler.jsonc",
    "node_modules/wrangler/bin/wrangler.js",
    ["deploy", "--dry-run", "--outdir", ".cloudflare-build"],
  ],
  [
    "Cloudflare local runtime",
    "Approval flow runs in workerd against real PostgreSQL, with no absent-worker jobs",
    "tests/cloudflare-smoke.ts",
    "node_modules/tsx/dist/cli.mjs",
    ["tests/cloudflare-smoke.ts"],
  ],
] as const;
let failed = false;
for (const [name, expected, source, file, args] of steps) {
  const tick = Date.now();
  const child = spawn(process.execPath, [file, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      WRANGLER_SEND_METRICS: "false",
    },
  });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  const [code] = await once(child, "exit");
  const pass = code === 0;
  checks.push({
    name,
    expected,
    source,
    status: pass ? "passed" : "failed",
    observed: `Process exit ${code}; ${pass ? "completed successfully" : "see raw test artifacts"}.`,
    durationMs: Date.now() - tick,
  });
  if (!pass) {
    failed = true;
    break;
  }
  if (name === "API and database guarantees") {
    const report = JSON.parse(await readFile("evidence/vitest.json", "utf8"));
    checks.pop();
    for (const suite of report.testResults)
      for (const result of suite.assertionResults)
        checks.push({
          name: result.fullName,
          expected:
            "Assertion set passes against real PostgreSQL with the restricted application role.",
          observed:
            result.status === "passed"
              ? "All assertions passed."
              : "See evidence/vitest.json.",
          status: result.status === "passed" ? "passed" : "failed",
          source,
          durationMs: result.duration,
        });
  }
  if (name === "Recovery scenarios") {
    const report = JSON.parse(await readFile("evidence/recovery.json", "utf8"));
    checks.pop();
    for (const result of report.tests)
      checks.push({
        ...result,
        expected:
          "Failure injection recovers without duplicate persisted results.",
        source,
      });
  }
  if (name === "Browser workflow") {
    const report = JSON.parse(
      await readFile("evidence/playwright.json", "utf8"),
    );
    checks.at(-1)!.observed =
      `${report.stats.expected} passed; ${report.stats.unexpected} failed; desktop and mobile Chromium.`;
  }
}
checks.push({
  name: "Docker Compose execution",
  status: "unverified",
  expected:
    "Build images, bootstrap a clean database and complete the browser workflow with a running report worker.",
  observed:
    "Separate container job and its artifacts must be inspected; this local/integration runner does not attest Docker execution.",
  source: "compose.yaml",
});
checks.push({
  name: "Public Cloudflare deployment",
  status: "unverified",
  expected:
    "Free managed database, restricted role, deployed URL, runtime CPU and browser smoke checks.",
  observed:
    "Deployment has not been verified. A dry-run build is not a public deployment.",
  source: "docs/DEPLOYMENT.md",
});
let commit: string | null = null;
let dirty = true;
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  dirty = Boolean(
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  );
} catch {
  /* Export without .git is supported. */
}
let pgVersion = "unknown";
if (process.env.DATABASE_URL) {
  const db = connectDatabase(process.env.DATABASE_URL);
  try {
    pgVersion = (
      await db.$queryRaw<Array<{ version: string }>>`SELECT version()`
    )[0].version;
  } finally {
    await db.$disconnect();
  }
}
const stable = (await sourceHash()) === hash;
if (!stable) {
  failed = true;
  checks.forEach((check) => {
    if (check.status === "passed") {
      check.status = "unverified";
      check.observed = "Source changed during the run. Repeat verification.";
    }
  });
}
const ciUrl = process.env.GITHUB_ACTIONS
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;
const prefix = process.env.PROOF_SOURCE_PREFIX ?? "";
const manifest = {
  generatedAt: new Date().toISOString(),
  startedAt: new Date(started).toISOString(),
  environment: `${process.platform}/${process.arch}; Node ${process.version}; ${pgVersion}`,
  commit,
  dirty,
  sourceHash: hash,
  ciUrl,
  sourceUrl:
    ciUrl && !dirty
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/blob/${commit}${prefix ? "/" + prefix : ""}`
      : null,
  checks,
};
await writeFile(
  "evidence/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
await mkdir("apps/web/public", { recursive: true });
await copyFile("evidence/manifest.json", "apps/web/public/proof.json");
await mkdir("apps/web/out", { recursive: true });
await copyFile("evidence/manifest.json", "apps/web/out/proof.json");
console.log(
  `Evidence written. ${failed ? "Verification failed." : "Verification complete."}`,
);
if (failed) process.exitCode = 1;
