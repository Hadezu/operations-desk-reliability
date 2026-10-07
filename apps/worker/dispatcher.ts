import type { Database } from "../../packages/core/db.js";
import type { Queue } from "bullmq";
import { reportJobId, type ReportJob } from "./queue.js";

export async function dispatchOne(
  db: Database,
  queue: Queue<ReportJob>,
  hooks: { afterPublish?: () => Promise<void>; leaseMs?: number } = {},
) {
  const leaseToken = crypto.randomUUID();
  const leaseUntil = new Date(Date.now() + (hooks.leaseMs ?? 30000));
  const event = await db.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM outbox_events
      WHERE status='PENDING' OR (status='DISPATCHING' AND lease_until < now())
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!candidates.length) return null;
    return tx.outboxEvent.update({
      where: { id: candidates[0].id },
      data: { status: "DISPATCHING", leaseToken, leaseUntil },
    });
  });
  if (!event) return false;
  await queue.add(
    "generate-report",
    { eventId: event.id, generation: event.replayGeneration },
    { jobId: reportJobId(event.id, event.replayGeneration) },
  );
  // Failure here deliberately leaves the durable lease to expire. Republishing
  // the same generation is safe even if the queue has already processed it.
  await hooks.afterPublish?.();
  await db.outboxEvent.updateMany({
    where: { id: event.id, status: "DISPATCHING", leaseToken },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      leaseToken: null,
      leaseUntil: null,
    },
  });
  return true;
}

export async function reconcilePublished(
  db: Database,
  queue: Queue<ReportJob>,
) {
  const events = await db.outboxEvent.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { publishedAt: "asc" },
    take: 100,
  });
  for (const event of events) {
    const report = await db.report.findUnique({
      where: { outboxId: event.id },
    });
    if (report) {
      await db.outboxEvent.updateMany({
        where: { id: event.id, status: "PUBLISHED" },
        data: { status: "COMPLETED" },
      });
      continue;
    }
    const job = await queue.getJob(
      reportJobId(event.id, event.replayGeneration),
    );
    if (!job)
      await db.outboxEvent.updateMany({
        where: {
          id: event.id,
          status: "PUBLISHED",
          replayGeneration: event.replayGeneration,
        },
        data: { status: "PENDING" },
      });
    else if ((await job.getState()) === "failed")
      await db.outboxEvent.updateMany({
        where: {
          id: event.id,
          status: "PUBLISHED",
          replayGeneration: event.replayGeneration,
        },
        data: { status: "FAILED" },
      });
  }
}
