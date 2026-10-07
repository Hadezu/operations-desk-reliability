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
  id: string | null,
  body: unknown,
  key: string | null,
  correlationId: string,
  reports = false,
) {
  if (!key || !/^[a-zA-Z0-9_-]{8,100}$/.test(key))
    throw new AppError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Supply an Idempotency-Key of 8–100 letters, numbers, hyphens or underscores.",
    );
  const fingerprint = await hash(JSON.stringify(body));
  const rows = await db.$queryRaw<
    Array<{ result: { ok: boolean; code?: string; value?: unknown } }>
  >`
    SELECT public.apply_request_command(
      ${identity.organizationId}::uuid,${identity.memberId}::uuid,${operation},${id}::uuid,
      ${key},${fingerprint},${JSON.stringify(body)}::jsonb,${correlationId},${reports}
    ) AS result`;
  const result = rows[0].result;
  if (result.ok) return requestDto(result.value);
  switch (result.code) {
    case "FORBIDDEN":
      denied();
    case "NOT_FOUND":
      missing();
    case "VERSION_CONFLICT":
      conflict();
    case "SELF_APPROVAL":
      throw new AppError(
        403,
        result.code,
        "A manager cannot decide their own request.",
      );
    case "IDEMPOTENCY_MISMATCH":
      throw new AppError(
        409,
        result.code,
        "This key was already used with different input.",
      );
    case "DEMO_LIMIT":
      throw new AppError(
        429,
        result.code,
        "This demo organization has reached its 100-request limit.",
      );
    default:
      throw Error("Database rejected an invalid command");
  }
}

export async function createRequest(
  db: Database,
  identity: Identity,
  input: unknown,
  key: string | null,
  correlationId: string,
) {
  if (identity.role === "OBSERVER") denied();
  return command(
    db,
    identity,
    "create",
    null,
    CreateRequest.parse(input),
    key,
    correlationId,
  );
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
  return command(
    db,
    identity,
    "edit",
    id,
    EditRequest.parse(input),
    key,
    correlationId,
  );
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
  return command(
    db,
    identity,
    "submit",
    id,
    SubmitRequest.parse(input),
    key,
    correlationId,
  );
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
  return command(
    db,
    identity,
    "decision",
    id,
    Decision.parse(input),
    key,
    correlationId,
    backgroundMode === "bullmq",
  );
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
