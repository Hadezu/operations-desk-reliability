import { z } from "zod";
import {
  Id,
  ListQuery,
  Replay,
  SwitchIdentity,
  openApiDocument,
} from "../contracts/index.js";
import {
  authenticate,
  sessionView,
  startDemo,
  switchIdentity,
  type Identity,
} from "./auth.js";
import {
  audit,
  createRequest,
  decideRequest,
  deleteDraft,
  editDraft,
  requestDto,
  submitRequest,
  visibleTo,
} from "./commands.js";
import type { Database } from "./db.js";
import { AppError, denied, missing } from "./errors.js";

export interface HttpOptions {
  db: Database;
  origin: string;
  backgroundMode: "bullmq" | "disabled";
  demoDailyLimit?: number;
  log?: (entry: Record<string, unknown>) => void;
}

function cookie(request: Request, name: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
function response(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}
async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError(415, "JSON_REQUIRED", "Use application/json.");
  if (!request.body)
    throw new AppError(400, "INVALID_JSON", "JSON body required.");
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new AppError(413, "BODY_TOO_LARGE", "Request exceeds 16 KB.");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError(400, "INVALID_JSON", "Malformed JSON body.");
  }
}
const Cursor = z
  .object({
    createdAt: z.iso.datetime(),
    id: Id,
    status: z.string().optional(),
    category: z.string().optional(),
  })
  .strict();

export async function handleApi(
  request: Request,
  options: HttpOptions,
): Promise<Response> {
  const correlationId = crypto.randomUUID();
  const started = Date.now();
  let actor: Identity | undefined;
  let result: Response;
  const url = new URL(request.url);
  const { db } = options;
  try {
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (mutating && request.headers.get("origin") !== options.origin)
      throw new AppError(
        403,
        "ORIGIN_REJECTED",
        "A same-origin request is required.",
      );
    if (url.pathname === "/api/health" && request.method === "GET") {
      await db.$queryRaw`SELECT 1`;
      result = response({
        status: "ok",
        backgroundMode: options.backgroundMode,
      });
    } else if (
      url.pathname === "/api/openapi.json" &&
      request.method === "GET"
    ) {
      result = response(openApiDocument());
    } else if (url.pathname === "/api/demo" && request.method === "POST") {
      // Reuse an unexpired session instead of allocating data on every click.
      const existingToken = cookie(request, "desk_session");
      if (existingToken) {
        try {
          actor = await authenticate(db, existingToken);
        } catch (error) {
          if (!(error instanceof AppError && error.status === 401)) throw error;
        }
      }
      if (actor)
        result = response(await sessionView(db, actor, options.backgroundMode));
      else {
        const session = await startDemo(db, options.demoDailyLimit);
        actor = await authenticate(db, session.sessionToken);
        const secure = options.origin.startsWith("https:") ? "; Secure" : "";
        result = response(
          await sessionView(db, actor, options.backgroundMode),
          200,
          {
            "set-cookie": `desk_session=${session.sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`,
          },
        );
      }
    } else {
      actor = await authenticate(db, cookie(request, "desk_session"));
      if (mutating && request.headers.get("x-csrf-token") !== actor.csrfToken)
        throw new AppError(
          403,
          "CSRF_REJECTED",
          "Refresh your session before retrying.",
        );
      const key = request.headers.get("idempotency-key");
      const match = url.pathname.match(
        /^\/api\/requests\/([^/]+)(?:\/(submit|decision|audit|report|replay))?$/,
      );
      if (url.pathname === "/api/session" && request.method === "GET")
        result = response(await sessionView(db, actor, options.backgroundMode));
      else if (
        url.pathname === "/api/session/switch" &&
        request.method === "POST"
      ) {
        const { memberId } = SwitchIdentity.parse(await body(request));
        await switchIdentity(db, actor, memberId);
        actor = await authenticate(db, cookie(request, "desk_session"));
        result = response(await sessionView(db, actor, options.backgroundMode));
      } else if (
        url.pathname === "/api/session" &&
        request.method === "DELETE"
      ) {
        await db.session.delete({ where: { tokenHash: actor.tokenHash } });
        result = response({ signedOut: true }, 200, {
          "set-cookie": `desk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${options.origin.startsWith("https:") ? "; Secure" : ""}`,
        });
      } else if (
        url.pathname === "/api/requests" &&
        request.method === "POST"
      ) {
        result = response(
          await createRequest(
            db,
            actor,
            await body(request),
            key,
            correlationId,
          ),
        );
      } else if (url.pathname === "/api/requests" && request.method === "GET") {
        const query = ListQuery.parse(Object.fromEntries(url.searchParams));
        let cursor: z.infer<typeof Cursor> | undefined;
        if (query.cursor) {
          try {
            cursor = Cursor.parse(JSON.parse(atob(query.cursor)));
          } catch {
            throw new AppError(
              400,
              "INVALID_CURSOR",
              "Invalid pagination cursor.",
            );
          }
          if (
            cursor.status !== query.status ||
            cursor.category !== query.category
          )
            throw new AppError(
              400,
              "INVALID_CURSOR",
              "Cursor belongs to different filters.",
            );
        }
        const rows = await db.request.findMany({
          where: {
            ...visibleTo(actor),
            status: query.status,
            category: query.category,
            ...(cursor
              ? {
                  OR: [
                    { createdAt: { lt: new Date(cursor.createdAt) } },
                    {
                      createdAt: new Date(cursor.createdAt),
                      id: { lt: cursor.id },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: query.limit + 1,
        });
        const hasMore = rows.length > query.limit;
        rows.splice(query.limit);
        const last = rows.at(-1);
        result = response({
          items: rows.map(requestDto),
          nextCursor:
            hasMore && last
              ? btoa(
                  JSON.stringify({
                    createdAt: last.createdAt.toISOString(),
                    id: last.id,
                    status: query.status,
                    category: query.category,
                  }),
                )
              : null,
        });
      } else if (match) {
        const id = Id.parse(match[1]);
        const action = match[2];
        if (request.method === "GET") {
          const record = await db.request.findFirst({
            where: { id, ...visibleTo(actor) },
          });
          if (!record) missing();
          if (!action) result = response(requestDto(record));
          else if (action === "audit")
            result = response({
              items: await db.auditEvent.findMany({
                where: { organizationId: actor.organizationId, entityId: id },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                take: 200,
              }),
            });
          else if (action === "report") {
            const report = await db.report.findFirst({
              where: { organizationId: actor.organizationId, requestId: id },
            });
            const event = await db.outboxEvent.findFirst({
              where: { organizationId: actor.organizationId, requestId: id },
            });
            const attempts = event
              ? await db.jobAttempt.findMany({
                  where: { outboxId: event.id },
                  orderBy: { startedAt: "asc" },
                  take: 100,
                })
              : [];
            result = response({
              mode: options.backgroundMode,
              report,
              event,
              attempts,
            });
          } else missing();
        } else if (request.method === "PATCH" && !action)
          result = response(
            await editDraft(
              db,
              actor,
              id,
              await body(request),
              key,
              correlationId,
            ),
          );
        else if (request.method === "DELETE" && !action)
          result = response(
            await deleteDraft(
              db,
              actor,
              id,
              await body(request),
              correlationId,
            ),
          );
        else if (request.method === "POST" && action === "submit")
          result = response(
            await submitRequest(
              db,
              actor,
              id,
              await body(request),
              key,
              correlationId,
            ),
          );
        else if (request.method === "POST" && action === "decision")
          result = response(
            await decideRequest(
              db,
              actor,
              id,
              await body(request),
              key,
              correlationId,
              options.backgroundMode,
            ),
          );
        else if (request.method === "POST" && action === "replay") {
          if (actor.role !== "MANAGER") denied();
          if (options.backgroundMode !== "bullmq")
            throw new AppError(
              409,
              "WORKER_UNAVAILABLE",
              "Report processing is available in the full Docker environment.",
            );
          const { reason } = Replay.parse(await body(request));
          const identity = actor;
          const event = await db.$transaction(async (tx) => {
            const found = await tx.outboxEvent.findFirst({
              where: { organizationId: identity.organizationId, requestId: id },
            });
            if (!found) missing();
            const updated = await tx.outboxEvent.updateMany({
              where: {
                id: found.id,
                organizationId: identity.organizationId,
                status: "FAILED",
                replayGeneration: found.replayGeneration,
              },
              data: {
                status: "PENDING",
                replayGeneration: { increment: 1 },
                leaseToken: null,
                leaseUntil: null,
                publishedAt: null,
              },
            });
            if (!updated.count)
              throw new AppError(
                409,
                "NOT_REPLAYABLE",
                "Only a terminal failed report can be replayed.",
              );
            await audit(
              tx,
              identity,
              id,
              "REPORT_REPLAY_REQUESTED",
              correlationId,
              { reason, generation: found.replayGeneration + 1 },
            );
            return { replayRequested: true };
          });
          result = response(event);
        } else missing();
      } else missing();
    }
  } catch (error) {
    const known =
      error instanceof AppError
        ? error
        : error instanceof z.ZodError
          ? new AppError(
              400,
              "VALIDATION_ERROR",
              "Input does not match the API contract.",
            )
          : new AppError(
              500,
              "INTERNAL_ERROR",
              "The operation could not be completed.",
            );
    // Do not log exception messages: drivers may include connection details or SQL values.
    options.log?.({
      level: "error",
      event: "request_failed",
      request_id: correlationId,
      error_code: known.code,
      error_type: error instanceof Error ? error.name : "unknown",
    });
    result = response(
      {
        error: {
          code: known.code,
          message: known.message,
          requestId: correlationId,
        },
      },
      known.status,
    );
  }
  result.headers.set("x-request-id", correlationId);
  options.log?.({
    level: "info",
    event: "http_completed",
    request_id: correlationId,
    organization_id: actor?.organizationId,
    user_id: actor?.memberId,
    method: request.method,
    status: result.status,
    duration_ms: Date.now() - started,
  });
  return result;
}
