import { z } from "zod";

export const Role = z.enum(["EMPLOYEE", "MANAGER", "OBSERVER"]);
export const Status = z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]);
export const Category = z.enum(["EQUIPMENT", "SOFTWARE", "TRAVEL"]);
export const Id = z.uuid();
export const CreateRequest = z
  .object({
    title: z.string().trim().min(3).max(100),
    description: z.string().trim().min(5).max(1000),
    category: Category,
    amountCents: z.number().int().min(1).max(10_000_000),
  })
  .strict();
export const EditRequest = CreateRequest.extend({
  version: z.number().int().positive(),
});
export const SubmitRequest = z
  .object({ version: z.number().int().positive() })
  .strict();
export const Decision = z
  .object({
    version: z.number().int().positive(),
    decision: z.enum(["APPROVED", "REJECTED"]),
    comment: z.string().trim().min(3).max(500),
  })
  .strict();
export const SwitchIdentity = z.object({ memberId: Id }).strict();
export const Replay = z
  .object({ reason: z.string().trim().min(5).max(500) })
  .strict();
export const ListQuery = z
  .object({
    status: Status.optional(),
    category: Category.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: z.string().max(300).optional(),
  })
  .strict();
export const RequestRecord = CreateRequest.extend({
  id: Id,
  organizationId: Id,
  ownerId: Id,
  status: Status,
  version: z.number().int().positive(),
  decisionComment: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});
export type RequestDto = z.infer<typeof RequestRecord>;
export type CreateInput = z.infer<typeof CreateRequest>;
export type RoleName = z.infer<typeof Role>;

export const commandRoutes = [
  {
    method: "post",
    path: "/api/requests",
    operationId: "createRequest",
    input: CreateRequest,
    output: RequestRecord,
  },
  {
    method: "patch",
    path: "/api/requests/{id}",
    operationId: "editDraft",
    input: EditRequest,
    output: RequestRecord,
  },
  {
    method: "post",
    path: "/api/requests/{id}/submit",
    operationId: "submitRequest",
    input: SubmitRequest,
    output: RequestRecord,
  },
  {
    method: "post",
    path: "/api/requests/{id}/decision",
    operationId: "decideRequest",
    input: Decision,
    output: RequestRecord,
  },
] as const;

export function openApiDocument() {
  const paths = Object.fromEntries(
    commandRoutes.map((route) => [
      route.path,
      {
        [route.method]: {
          operationId: route.operationId,
          security: [{ session: [] }],
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string", minLength: 8, maxLength: 100 },
            },
            {
              name: "X-CSRF-Token",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
            ...(route.path.includes("{id}")
              ? [
                  {
                    name: "id",
                    in: "path",
                    required: true,
                    schema: { type: "string", format: "uuid" },
                  },
                ]
              : []),
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: z.toJSONSchema(route.input) },
            },
          },
          responses: {
            "200": {
              description:
                "Applied, or the original result of an identical command.",
              content: {
                "application/json": { schema: z.toJSONSchema(route.output) },
              },
            },
            ...Object.fromEntries(
              ["400", "401", "403", "404", "409", "429", "500"].map((code) => [
                code,
                {
                  description: "Structured error",
                  content: {
                    "application/json": {
                      schema: z.toJSONSchema(ErrorResponse),
                    },
                  },
                },
              ]),
            ),
          },
        },
      },
    ]),
  );
  return {
    openapi: "3.1.0",
    info: {
      title: "Operations Desk command API",
      version: "0.1.0",
      description:
        "Command contract. All mutations require same-origin requests. See README for read/session endpoints.",
    },
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "desk_session" },
      },
    },
    paths,
  };
}
