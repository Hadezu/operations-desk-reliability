import type { Database, DatabaseSession, Prisma } from "./db.js";
import type { Identity } from "./auth.js";
import { hash } from "./auth.js";
import { AppError, conflict, denied, missing } from "./errors.js";
import {
  CreateRequest,
  Decision,
  EditRequest,
  RequestRecord,
  SubmitRequest,
} from "../contracts/index.js";

type Tx = DatabaseSession;
export function visibleTo(identity: Identity) {
  return {
    organizationId: identity.organizationId,
    ...(identity.role === "EMPLOYEE" ? { ownerId: identity.memberId } : {}),
  };
}
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}
export function requestDto(value: unknown) {
  return RequestRecord.parse(JSON.parse(JSON.stringify(value)));
}

export async function audit(
  tx: Tx,
  identity: Pick<Identity, "organizationId" | "memberId">,
  entityId: string,
  action: string,
  correlationId: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await tx.auditEvent.create({
    data: {
      organizationId: identity.organizationId,
      actorId: identity.memberId,
      entityId,
      action,
      correlationId,
      metadata,
    },
  });
}

async function command(
  db: Database,
  identity: Identity,
  operation: string,
  key: string | null,
  body: unknown,
  run: (tx: Tx) => Promise<unknown>,
) {
  if (!key || !/^[a-zA-Z0-9_-]{8,100}$/.test(key))
    throw new AppError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Supply an Idempotency-Key of 8–100 letters, numbers, hyphens or underscores.",
    );
  const fingerprint = await hash(JSON.stringify(body));
  return db.$transaction(
    async (tx) => {
      // PostgreSQL's unique constraint arbitrates concurrent claims. ON CONFLICT
      // waits for an in-flight transaction; the following READ COMMITTED read sees it.
      await tx.$executeRaw`INSERT INTO commands (id, organization_id, actor_id, operation, key, fingerprint)
      VALUES (${crypto.randomUUID()}::uuid, ${identity.organizationId}::uuid, ${identity.memberId}::uuid, ${operation}, ${key}, ${fingerprint})
      ON CONFLICT (organization_id, actor_id, operation, key) DO NOTHING`;
      const record = await tx.command.findUniqueOrThrow({
        where: {
          organizationId_actorId_operation_key: {
            organizationId: identity.organizationId,
            actorId: identity.memberId,
            operation,
            key,
          },
        },
      });
      if (record.fingerprint !== fingerprint)
        throw new AppError(
          409,
          "IDEMPOTENCY_MISMATCH",
          "This key was already used with different input.",
        );
      if (record.result !== null) return record.result;
      const result = json(await run(tx));
      await tx.command.update({ where: { id: record.id }, data: { result } });
      return result;
    },
    { maxWait: 10000, timeout: 15000 },
  );
}

export async function createRequest(
  db: Database,
  identity: Identity,
  input: unknown,
  key: string | null,
  correlationId: string,
) {
  if (identity.role === "OBSERVER") denied();
  const body = CreateRequest.parse(input);
  return command(db, identity, "create", key, body, async (tx) => {
    // Serialize the demo quota check per organization, rather than a racy count.
    await tx.$queryRaw`SELECT id FROM organizations WHERE id=${identity.organizationId}::uuid FOR UPDATE`;
    if (
      (await tx.request.count({
        where: { organizationId: identity.organizationId },
      })) >= 100
    )
      throw new AppError(
        429,
        "DEMO_LIMIT",
        "This demo organization has reached its 100-request limit.",
      );
    const record = await tx.request.create({
      data: {
        ...body,
        organizationId: identity.organizationId,
        ownerId: identity.memberId,
      },
    });
    await audit(tx, identity, record.id, "REQUEST_CREATED", correlationId);
    return requestDto(record);
  });
}

export async function editDraft(
  db: Database,
  identity: Identity,
  id: string,
  input: unknown,
  key: string | null,
  correlationId: string,
) {
  if (identity.role === "OBSERVER") denied();
  const body = EditRequest.parse(input);
  return command(db, identity, `edit:${id}`, key, body, async (tx) => {
    const existing = await tx.request.findFirst({
      where: { id, ...visibleTo(identity) },
    });
    if (!existing) missing();
    if (existing.ownerId !== identity.memberId) denied();
    const { version, ...fields } = body;
    const result = await tx.request.updateMany({
      where: {
        id,
        organizationId: identity.organizationId,
        ownerId: identity.memberId,
        status: "DRAFT",
        version,
      },
      data: { ...fields, version: { increment: 1 }, updatedAt: new Date() },
    });
    if (!result.count) conflict();
    await audit(tx, identity, id, "REQUEST_EDITED", correlationId);
    return requestDto(
      await tx.request.findFirstOrThrow({
        where: { id, organizationId: identity.organizationId },
      }),
    );
  });
}

export async function submitRequest(
  db: Database,
  identity: Identity,
  id: string,
  input: unknown,
  key: string | null,
  correlationId: string,
) {
  if (identity.role === "OBSERVER") denied();
  const body = SubmitRequest.parse(input);
  return command(db, identity, `submit:${id}`, key, body, async (tx) => {
    const existing = await tx.request.findFirst({
      where: { id, ...visibleTo(identity) },
    });
    if (!existing) missing();
    if (existing.ownerId !== identity.memberId) denied();
    const changed = await tx.request.updateMany({
      where: {
        id,
        organizationId: identity.organizationId,
        ownerId: identity.memberId,
        status: "DRAFT",
        version: body.version,
      },
      data: {
        status: "SUBMITTED",
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (!changed.count) conflict();
    await audit(tx, identity, id, "REQUEST_SUBMITTED", correlationId);
    return requestDto(
      await tx.request.findFirstOrThrow({
        where: { id, organizationId: identity.organizationId },
      }),
    );
  });
}

export async function decideRequest(
  db: Database,
  identity: Identity,
  id: string,
  input: unknown,
  key: string | null,
  correlationId: string,
  backgroundMode: "bullmq" | "disabled",
) {
  if (identity.role !== "MANAGER") denied();
  const body = Decision.parse(input);
  return command(db, identity, `decision:${id}`, key, body, async (tx) => {
    const existing = await tx.request.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!existing) missing();
    if (existing.ownerId === identity.memberId)
      throw new AppError(
        403,
        "SELF_APPROVAL",
        "A manager cannot decide their own request.",
      );
    const result = await tx.request.updateMany({
      where: {
        id,
        organizationId: identity.organizationId,
        status: "SUBMITTED",
        version: body.version,
      },
      data: {
        status: body.decision,
        decisionComment: body.comment,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (!result.count) conflict();
    await audit(tx, identity, id, `REQUEST_${body.decision}`, correlationId, {
      comment: body.comment,
    });
    if (body.decision === "APPROVED" && backgroundMode === "bullmq") {
      await tx.outboxEvent.create({
        data: {
          organizationId: identity.organizationId,
          requestId: id,
          correlationId,
        },
      });
      await audit(tx, identity, id, "REPORT_REQUESTED", correlationId);
    }
    return requestDto(
      await tx.request.findFirstOrThrow({
        where: { id, organizationId: identity.organizationId },
      }),
    );
  });
}

export async function deleteDraft(
  db: Database,
  identity: Identity,
  id: string,
  input: unknown,
  correlationId: string,
) {
  if (identity.role === "OBSERVER") denied();
  const { version } = SubmitRequest.parse(input);
  return db.$transaction(async (tx) => {
    const existing = await tx.request.findFirst({
      where: { id, ...visibleTo(identity) },
    });
    if (!existing) missing();
    if (existing.ownerId !== identity.memberId) denied();
    const result = await tx.request.deleteMany({
      where: {
        id,
        organizationId: identity.organizationId,
        ownerId: identity.memberId,
        status: "DRAFT",
        version,
      },
    });
    if (!result.count) conflict();
    await audit(tx, identity, id, "REQUEST_DELETED", correlationId);
    return { deleted: true };
  });
}
