import "dotenv/config";
import { Worker } from "bullmq";
import pino from "pino";
import { connectDatabase } from "../../packages/core/db.js";
import {
  queueName,
  redisConnection,
  reportQueue,
  type ReportJob,
} from "./queue.js";
import { dispatchOne, reconcilePublished } from "./dispatcher.js";
import { processReport } from "./processor.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required.");
const db = connectDatabase(process.env.DATABASE_URL);
const queue = reportQueue();
const log = pino();
const testMode = process.env.NODE_ENV === "test";
const worker = new Worker<ReportJob>(
  queueName,
  async (job) =>
    processReport(db, job, {
      log: (entry) => log.info(entry),
      afterStart:
        testMode && process.env.TEST_FAULT === "poison"
          ? async () => {
              throw new Error("Injected poison job");
            }
          : testMode && process.env.TEST_FAULT === "hang"
            ? async () => {
                await new Promise((resolve) => setTimeout(resolve, 120000));
              }
            : undefined,
      afterPersist:
        testMode && process.env.TEST_FAULT === "crash-after-persist"
          ? async () => {
              process.exit(77);
            }
          : undefined,
    }),
  {
    connection: redisConnection(),
    concurrency: 2,
    lockDuration: testMode ? 2000 : 30000,
    stalledInterval: testMode ? 1000 : 30000,
    maxStalledCount: 2,
  },
);
worker.on("error", () => log.error({ event: "queue_connection_error" }));
worker.on("failed", (job) =>
  log.warn({ event: "job_failed", job_id: job?.id }),
);
queue.on("error", () => log.error({ event: "dispatcher_connection_error" }));
let stopping = false;
let tick = 0;
async function loop() {
  while (!stopping) {
    try {
      for (let i = 0; i < 20 && !stopping; i++)
        if (!(await dispatchOne(db, queue))) break;
      if (tick++ % 30 === 0) await reconcilePublished(db, queue);
    } catch {
      log.error({ event: "outbox_dispatch_failed" });
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
const dispatching = loop();
async function stop() {
  if (stopping) return;
  stopping = true;
  await dispatching;
  await worker.close();
  await queue.close();
  await db.$disconnect();
}
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
log.info({ event: "worker_ready", queue: queueName });
