import type { Job } from "bullmq";
import type { Database } from "../../packages/core/db.js";
import type { ReportJob } from "./queue.js";

export interface ProcessorHooks {
  afterStart?: () => Promise<void>;
  afterPersist?: () => Promise<void>;
  log?: (entry: Record<string, unknown>) => void;
}
export async function processReport(
  db: Database,
  job: Job<ReportJob>,
  hooks: ProcessorHooks = {},
) {
  const event = await db.outboxEvent.findUniqueOrThrow({
    where: { id: job.data.eventId },
  });
  // An old generation must not undo a newer replay or its result.
  if (event.replayGeneration !== job.data.generation) return { ignored: true };
  const attempt = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM outbox_events WHERE id=${event.id}::uuid FOR UPDATE`;
    await tx.jobAttempt.updateMany({
      where: { outboxId: event.id, status: "RUNNING" },
      data: {
        status: "INTERRUPTED",
        errorCode: "LEASE_RECOVERED",
        finishedAt: new Date(),
      },
    });
    const created = await tx.jobAttempt.create({
      data: { outboxId: event.id, jobId: String(job.id), status: "RUNNING" },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: event.organizationId,
        entityId: event.requestId,
        action: "REPORT_ATTEMPT_STARTED",
        correlationId: event.correlationId,
        metadata: {
          attemptId: created.id,
          jobId: String(job.id),
          generation: job.data.generation,
        },
      },
    });
    return created;
  });
  hooks.log?.({
    event: "report_started",
    request_id: event.correlationId,
    organization_id: event.organizationId,
    job_id: job.id,
    attempt_id: attempt.id,
  });
  try {
    await hooks.afterStart?.();
    const record = await db.request.findFirstOrThrow({
      where: {
        id: event.requestId,
        organizationId: event.organizationId,
        status: "APPROVED",
      },
    });
    // The report is immutable approval data. A database unique constraint is the
    // final guard even when a stalled job overlaps a still-running old worker.
    const report = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM outbox_events WHERE id=${event.id}::uuid FOR UPDATE`;
      const existing = await tx.report.findUnique({
        where: { outboxId: event.id },
      });
      const result =
        existing ??
        (await tx.report.create({
          data: {
            organizationId: event.organizationId,
            requestId: record.id,
            outboxId: event.id,
            content: {
              title: record.title,
              amountCents: record.amountCents,
              currency: "EUR",
              approvedVersion: record.version,
              category: record.category,
              decisionComment: record.decisionComment,
            },
          },
        }));
      await tx.jobAttempt.update({
        where: { id: attempt.id },
        data: { status: "COMPLETED", finishedAt: new Date() },
      });
      await tx.outboxEvent.updateMany({
        where: { id: event.id, replayGeneration: job.data.generation },
        data: { status: "COMPLETED", leaseToken: null, leaseUntil: null },
      });
      if (!existing)
        await tx.auditEvent.create({
          data: {
            organizationId: event.organizationId,
            entityId: record.id,
            action: "REPORT_COMPLETED",
            correlationId: event.correlationId,
            metadata: { reportId: result.id, attemptId: attempt.id },
          },
        });
      return result;
    });
    await hooks.afterPersist?.();
    hooks.log?.({
      event: "report_completed",
      request_id: event.correlationId,
      organization_id: event.organizationId,
      job_id: job.id,
      report_id: report.id,
    });
    return { reportId: report.id };
  } catch (error) {
    await db.$transaction(async (tx) => {
      await tx.jobAttempt.updateMany({
        where: { id: attempt.id, status: "RUNNING" },
        data: {
          status: "FAILED",
          errorCode: "REPORT_PROCESSING_FAILED",
          finishedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: event.organizationId,
          entityId: event.requestId,
          action: "REPORT_ATTEMPT_FAILED",
          correlationId: event.correlationId,
          metadata: { attemptId: attempt.id },
        },
      });
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1))
        await tx.outboxEvent.updateMany({
          where: {
            id: event.id,
            replayGeneration: job.data.generation,
            status: { not: "COMPLETED" },
          },
          data: { status: "FAILED" },
        });
    });
    // A generic error prevents database values or credentials entering queue logs.
    throw new Error("REPORT_PROCESSING_FAILED", {
      cause: error instanceof Error ? error.name : "unknown",
    });
  }
}
