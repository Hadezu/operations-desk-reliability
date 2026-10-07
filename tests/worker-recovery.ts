import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import { Redis } from "ioredis";
import { RequestRecord } from "../packages/contracts/index.js";
import { connectDatabase } from "../packages/core/db.js";
import { provisionRole } from "../scripts/provision-role.js";
import {
  startDemo,
  authenticate,
  switchIdentity,
} from "../packages/core/auth.js";
import {
  createRequest,
  submitRequest,
  decideRequest,
} from "../packages/core/commands.js";
import { handleApi } from "../packages/core/http.js";

if (
  !process.env.DATABASE_URL ||
  !process.env.MIGRATION_DATABASE_URL ||
  !process.env.REDIS_URL
)
  throw new Error(
    "Real PostgreSQL and Redis are required. No in-memory fallback.",
  );
const runId = crypto.randomUUID().replaceAll("-", "");
const databaseName = `desk_recovery_${runId}`;
process.env.QUEUE_NAME = `desk-recovery-${runId}`;
const { reportQueue, reportJobId } = await import("../apps/worker/queue.js");
const { dispatchOne, reconcilePublished } =
  await import("../apps/worker/dispatcher.js");
const admin = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
await admin.connect();
await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}`);
const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL);
ownerUrl.pathname = `/${databaseName}`;
const appUrl = new URL(process.env.DATABASE_URL);
appUrl.pathname = `/${databaseName}`;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: appUrl.href,
  MIGRATION_DATABASE_URL: ownerUrl.href,
  NODE_ENV: "test",
};
const db = connectDatabase(appUrl.href);
const queue = reportQueue();
const children: ChildProcess[] = [];
const results: Array<{
  name: string;
  status: string;
  durationMs: number;
  observed: string;
}> = [];
async function until(
  check: () => Promise<boolean>,
  description: string,
  timeout = 35000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out: ${description}`);
}
async function execute(file: string, args: string[]) {
  const child = spawn(process.execPath, [file, ...args], {
    env,
    stdio: "pipe",
    windowsHide: true,
  });
  let output = "";
  child.stdout?.on("data", (data) => {
    output += data;
  });
  child.stderr?.on("data", (data) => {
    output += data;
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output);
}
function worker(fault = "") {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/worker/main.ts"],
    { env: { ...env, TEST_FAULT: fault }, stdio: "pipe", windowsHide: true },
  );
  child.stdout?.resume();
  child.stderr?.resume();
  children.push(child);
  return child;
}
async function kill(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
  const exit = once(child, "exit");
  child.kill("SIGKILL");
  await exit;
}
let sessionToken: string;
let employee: Awaited<ReturnType<typeof authenticate>>;
let manager: Awaited<ReturnType<typeof authenticate>>;
async function approved() {
  const item = RequestRecord.parse(
    await createRequest(
      db,
      employee,
      {
        title: "Recovery test request",
        description: "Synthetic report recovery fixture.",
        category: "EQUIPMENT",
        amountCents: 90000,
      },
      crypto.randomUUID(),
      crypto.randomUUID(),
    ),
  );
  await submitRequest(
    db,
    employee,
    item.id,
    { version: 1 },
    crypto.randomUUID(),
    crypto.randomUUID(),
  );
  await decideRequest(
    db,
    manager,
    item.id,
    {
      version: 2,
      decision: "APPROVED",
      comment: "Approved for failure-injection testing.",
    },
    crypto.randomUUID(),
    crypto.randomUUID(),
    "bullmq",
  );
  return db.outboxEvent.findFirstOrThrow({ where: { requestId: item.id } });
}
async function completed(eventId: string, generation = 0) {
  await until(
    async () =>
      (await queue.getJob(reportJobId(eventId, generation)))
        ?.getState()
        .then((state) => state === "completed") ?? false,
    "queue acknowledgement",
  );
  assert.equal(await db.report.count({ where: { outboxId: eventId } }), 1);
  const event = await db.outboxEvent.findUniqueOrThrow({
    where: { id: eventId },
  });
  assert.equal(event.status, "COMPLETED");
  assert.equal(
    await db.auditEvent.count({
      where: { entityId: event.requestId, action: "REPORT_COMPLETED" },
    }),
    1,
  );
}
async function scenario(
  name: string,
  observed: string,
  fn: () => Promise<void>,
) {
  const started = Date.now();
  try {
    await fn();
    results.push({
      name,
      status: "passed",
      durationMs: Date.now() - started,
      observed,
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      status: "failed",
      durationMs: Date.now() - started,
      observed: error instanceof Error ? error.message : "Failure",
    });
    throw error;
  }
}
try {
  await execute("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
  await provisionRole(ownerUrl.href, appUrl.href);
  await db.$connect();
  await queue.waitUntilReady();
  const session = await startDemo(db);
  sessionToken = session.sessionToken;
  employee = await authenticate(db, sessionToken);
  const member = await db.member.findFirstOrThrow({
    where: { organizationId: employee.organizationId, role: "MANAGER" },
  });
  await switchIdentity(db, employee, member.id);
  manager = await authenticate(db, sessionToken);

  await scenario(
    "Outbox publication recovery",
    "Durable intent recovered; duplicate enqueue kept one job and one report.",
    async () => {
      const event = await approved();
      assert.equal(event.status, "PENDING");
      await assert.rejects(
        dispatchOne(db, queue, {
          leaseMs: 100,
          afterPublish: async () => {
            throw Error("Crash between publish and acknowledgement");
          },
        }),
      );
      assert.equal(
        (await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }))
          .status,
        "DISPATCHING",
      );
      await new Promise((r) => setTimeout(r, 150));
      await dispatchOne(db, queue);
      await queue.add(
        "generate-report",
        { eventId: event.id, generation: 0 },
        { jobId: reportJobId(event.id, 0) },
      );
      assert.equal(await queue.getWaitingCount(), 1);
      const child = worker();
      await completed(event.id);
      await kill(child);
    },
  );
  await scenario(
    "Worker termination and restart",
    "OS-killed a RUNNING worker; restart recovered the stalled job, one result, INTERRUPTED attempt retained.",
    async () => {
      const event = await approved();
      const child = worker("hang");
      await until(
        async () =>
          (await db.jobAttempt.count({
            where: { outboxId: event.id, status: "RUNNING" },
          })) === 1,
        "worker start",
      );
      await kill(child);
      const restarted = worker();
      await completed(event.id);
      await kill(restarted);
      assert.equal(
        await db.jobAttempt.count({
          where: { outboxId: event.id, status: "INTERRUPTED" },
        }),
        1,
      );
      assert.ok(
        (await db.jobAttempt.count({ where: { outboxId: event.id } })) >= 2,
      );
    },
  );
  await scenario(
    "Crash after result commit",
    "Process exited after PostgreSQL commit, before queue acknowledgement; restart retained one report and one completion audit.",
    async () => {
      const event = await approved();
      const child = worker("crash-after-persist");
      await until(async () => child.exitCode !== null, "injected process exit");
      assert.equal(child.exitCode, 77);
      const restarted = worker();
      await completed(event.id);
      await kill(restarted);
    },
  );
  await scenario(
    "Bounded failure and controlled replay",
    "Three failed attempts with backoff; observer denied; manager replay audited once; generation 1 produced one report.",
    async () => {
      const event = await approved();
      const child = worker("poison");
      await until(
        async () =>
          (await queue.getJob(reportJobId(event.id, 0)))
            ?.getState()
            .then((state) => state === "failed") ?? false,
        "bounded retries",
      );
      await kill(child);
      const attempts = await db.jobAttempt.findMany({
        where: { outboxId: event.id },
        orderBy: { startedAt: "asc" },
      });
      assert.equal(attempts.length, 3);
      assert.ok(attempts.every((a) => a.status === "FAILED"));
      assert.ok(
        attempts[1].startedAt.getTime() - attempts[0].startedAt.getTime() >=
          800,
      );
      assert.ok(
        attempts[2].startedAt.getTime() - attempts[1].startedAt.getTime() >=
          1800,
      );
      assert.equal(await db.report.count({ where: { outboxId: event.id } }), 0);
      const observer = await db.member.findFirstOrThrow({
        where: { organizationId: manager.organizationId, role: "OBSERVER" },
      });
      async function replay() {
        const actor = await authenticate(db, sessionToken);
        return handleApi(
          new Request(
            `http://localhost:3100/api/requests/${event.requestId}/replay`,
            {
              method: "POST",
              headers: {
                origin: "http://localhost:3100",
                cookie: `desk_session=${sessionToken}`,
                "x-csrf-token": actor.csrfToken,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                reason: "Operator checked the failure and authorized retry.",
              }),
            },
          ),
          { db, origin: "http://localhost:3100", backgroundMode: "bullmq" },
        );
      }
      await switchIdentity(db, manager, observer.id);
      assert.equal((await replay()).status, 403);
      await switchIdentity(db, manager, manager.memberId);
      assert.equal((await replay()).status, 200);
      assert.equal((await replay()).status, 409);
      const restarted = worker();
      await completed(event.id, 1);
      await kill(restarted);
      assert.equal(
        await db.auditEvent.count({
          where: {
            entityId: event.requestId,
            action: "REPORT_REPLAY_REQUESTED",
          },
        }),
        1,
      );
    },
  );
  await scenario(
    "Missing queue record reconciliation",
    "Removed a published queue record; reconciliation republished durable intent and produced one report.",
    async () => {
      const event = await approved();
      await dispatchOne(db, queue);
      await (await queue.getJob(reportJobId(event.id, 0)))!.remove();
      await reconcilePublished(db, queue);
      assert.equal(
        (await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }))
          .status,
        "PENDING",
      );
      const child = worker();
      await completed(event.id);
      await kill(child);
    },
  );
} finally {
  for (const child of children) await kill(child);
  const versions = await db.$queryRaw<
    Array<{ version: string }>
  >`SELECT version()`;
  const infoClient = new Redis(process.env.REDIS_URL);
  const redisInfo = await infoClient.info("server");
  await infoClient.quit();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/recovery.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        postgres: versions[0]?.version,
        redis: redisInfo.match(/redis_version:([^\r\n]+)/)?.[1],
        tests: results,
      },
      null,
      2,
    ),
  );
  await queue.obliterate({ force: true });
  await queue.close();
  await db.$disconnect();
  await admin.query(
    `DROP DATABASE ${pg.escapeIdentifier(databaseName)} WITH (FORCE)`,
  );
  await admin.end();
}
