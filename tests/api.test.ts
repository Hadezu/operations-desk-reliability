import "dotenv/config";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { connectDatabase } from "../packages/core/db.js";
import { connectEdgeDatabase } from "../packages/core/edge-db.js";
import { buildServer } from "../apps/api/server.js";
import {
  RequestRecord,
  ErrorResponse,
  openApiDocument,
} from "../packages/contracts/index.js";
import { hash, startDemo } from "../packages/core/auth.js";

if (!process.env.DATABASE_URL || !process.env.MIGRATION_DATABASE_URL)
  throw new Error(
    "Integration tests require real PostgreSQL. Start npm run db:local or Docker.",
  );
describe.each(["Prisma", "edge SQL"])("%s adapter", (adapter) => {
  const db = connectDatabase(process.env.DATABASE_URL!);
  const appDb =
    adapter === "Prisma"
      ? db
      : connectEdgeDatabase(process.env.DATABASE_URL!, 5);
  const owner = connectDatabase(process.env.MIGRATION_DATABASE_URL!);
  const appPromise = buildServer({
    db: appDb,
    origin: "http://localhost:3100",
    backgroundMode: "bullmq",
  });
  let app: Awaited<typeof appPromise>;
  const validInput = {
    title: "A new workstation",
    description: "Equipment for our new designer.",
    category: "EQUIPMENT",
    amountCents: 150000,
  };
  interface Demo {
    cookie: string;
    csrf: string;
    organizationId: string;
    memberId: string;
    organizations: Array<{
      id: string;
      members: Array<{ id: string; role: string }>;
    }>;
  }
  async function newDemo(): Promise<Demo> {
    const res = await app.inject({
      method: "POST",
      url: "/api/demo",
      headers: { origin: "http://localhost:3100" },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    return {
      cookie: String(res.headers["set-cookie"]).split(";")[0],
      csrf: data.csrfToken,
      organizationId: data.identity.organizationId,
      memberId: data.identity.memberId,
      organizations: data.organizations,
    };
  }
  async function call(
    demo: Demo,
    method: "POST" | "PATCH" | "GET" | "DELETE",
    url: string,
    payload?: unknown,
    key = crypto.randomUUID(),
  ) {
    return app.inject({
      method,
      url,
      headers: {
        origin: "http://localhost:3100",
        cookie: demo.cookie,
        "x-csrf-token": demo.csrf,
        "idempotency-key": key,
        ...(payload !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });
  }
  async function switchTo(
    demo: Demo,
    role: string,
    orgId = demo.organizationId,
  ) {
    const memberId = demo.organizations
      .find((o) => o.id === orgId)!
      .members.find((m) => m.role === role)!.id;
    const res = await call(demo, "POST", "/api/session/switch", { memberId });
    expect(res.statusCode).toBe(200);
    demo.csrf = res.json().csrfToken;
    demo.organizationId = orgId;
    demo.memberId = memberId;
  }
  async function create(demo: Demo) {
    const result = await call(demo, "POST", "/api/requests", validInput);
    expect(result.statusCode).toBe(200);
    return RequestRecord.parse(result.json());
  }
  let a: Demo;
  let b: Demo;
  beforeAll(async () => {
    app = await appPromise;
    a = await newDemo();
    b = await newDemo();
  });
  afterAll(async () => {
    await app.close();
    if (appDb !== db) await appDb.$disconnect();
    await db.$disconnect();
    await owner.$disconnect();
  });

  describe("tenant and session boundaries", () => {
    it("ADMISSION: concurrent visitors cannot exceed the daily workspace quota", async () => {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const before = await db.workspace.count({
        where: { createdAt: { gte: today } },
      });
      const outcomes = await Promise.allSettled([
        startDemo(appDb, before + 1),
        startDemo(appDb, before + 1),
      ]);
      expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const refusal = outcomes.find(
        (x) => x.status === "rejected",
      ) as PromiseRejectedResult;
      expect(refusal.reason).toMatchObject({
        status: 429,
        code: "DEMO_CAPACITY",
      });
      expect(
        await db.workspace.count({ where: { createdAt: { gte: today } } }),
      ).toBe(before + 1);
    });

    it("TENANT: blocks foreign read, edit, delete and audit", async () => {
      const record = await create(b);
      for (const [method, path, payload] of [
        ["GET", `/api/requests/${record.id}`, undefined],
        ["PATCH", `/api/requests/${record.id}`, { ...validInput, version: 1 }],
        ["DELETE", `/api/requests/${record.id}`, { version: 1 }],
        ["GET", `/api/requests/${record.id}/audit`, undefined],
      ] as const)
        expect((await call(a, method, path, payload)).statusCode).toBe(404);
      expect(
        await db.request.findUnique({ where: { id: record.id } }),
      ).not.toBeNull();
    });
    it("TENANT: ignores no client tenant override; rejects unknown properties", async () => {
      const response = await call(a, "POST", "/api/requests", {
        ...validInput,
        organizationId: b.organizationId,
      });
      expect(response.statusCode).toBe(400);
    });
    it("SESSION: cannot switch to another visitor identity", async () => {
      const response = await call(a, "POST", "/api/session/switch", {
        memberId: b.memberId,
      });
      expect(response.statusCode).toBe(403);
    });
    it("CSRF: rejects absent token and foreign origin", async () => {
      for (const headers of [
        { origin: "https://attacker.example", "x-csrf-token": a.csrf },
        { origin: "http://localhost:3100" },
      ]) {
        const result = await app.inject({
          method: "POST",
          url: "/api/requests",
          headers: {
            ...headers,
            cookie: a.cookie,
            "idempotency-key": crypto.randomUUID(),
          },
          payload: validInput,
        });
        expect(result.statusCode).toBe(403);
      }
    });
    it("SESSION: stores a hash, expires and revokes sessions", async () => {
      const demo = await newDemo();
      const raw = demo.cookie.split("=")[1];
      expect(
        await db.session.findUnique({ where: { tokenHash: raw } }),
      ).toBeNull();
      expect((await call(demo, "DELETE", "/api/session")).statusCode).toBe(200);
      expect((await call(demo, "GET", "/api/session")).statusCode).toBe(401);
      const expiring = await newDemo();
      await owner.session.update({
        where: { tokenHash: await hash(expiring.cookie.split("=")[1]) },
        data: { expiresAt: new Date(0) },
      });
      expect((await call(expiring, "GET", "/api/session")).statusCode).toBe(
        401,
      );
    });
  });

  describe("authorization and commands", () => {
    it("RBAC: employee cannot approve; observer cannot create or submit", async () => {
      const record = await create(a);
      expect(
        (
          await call(a, "POST", `/api/requests/${record.id}/decision`, {
            version: 1,
            decision: "APPROVED",
            comment: "Looks good",
          })
        ).statusCode,
      ).toBe(403);
      await switchTo(a, "OBSERVER");
      expect(
        (await call(a, "POST", "/api/requests", validInput)).statusCode,
      ).toBe(403);
      expect(
        (
          await call(a, "POST", `/api/requests/${record.id}/submit`, {
            version: 1,
          })
        ).statusCode,
      ).toBe(403);
      await switchTo(a, "EMPLOYEE");
    });
    it("IDEMPOTENCY: concurrent identical commands persist one entity and replay result", async () => {
      const key = crypto.randomUUID();
      const result = await Promise.all([
        call(a, "POST", "/api/requests", validInput, key),
        call(a, "POST", "/api/requests", validInput, key),
      ]);
      expect(result.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(result[0].json()).toEqual(result[1].json());
      const id = result[0].json().id;
      expect(await db.request.count({ where: { id } })).toBe(1);
      expect(
        await db.auditEvent.count({
          where: { entityId: id, action: "REQUEST_CREATED" },
        }),
      ).toBe(1);
      const changed = await call(
        a,
        "POST",
        "/api/requests",
        { ...validInput, title: "Other payload" },
        key,
      );
      expect(changed.statusCode).toBe(409);
      expect(changed.json().error.code).toBe("IDEMPOTENCY_MISMATCH");
    });
    it("IDEMPOTENCY: same key is isolated between tenants", async () => {
      const key = crypto.randomUUID();
      const results = await Promise.all([
        call(a, "POST", "/api/requests", validInput, key),
        call(b, "POST", "/api/requests", validInput, key),
      ]);
      expect(results.every((r) => r.statusCode === 200)).toBe(true);
      expect(results[0].json().id).not.toBe(results[1].json().id);
    });
    it("CONCURRENCY: one decision wins; the loser receives 409", async () => {
      const record = await create(a);
      expect(
        (
          await call(a, "POST", `/api/requests/${record.id}/submit`, {
            version: 1,
          })
        ).statusCode,
      ).toBe(200);
      await switchTo(a, "MANAGER");
      const results = await Promise.all(
        ["APPROVED", "REJECTED"].map((decision) =>
          call(a, "POST", `/api/requests/${record.id}/decision`, {
            version: 2,
            decision,
            comment: "Reviewed by manager",
          }),
        ),
      );
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const current = await db.request.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(current.version).toBe(3);
      expect(
        await db.auditEvent.count({
          where: {
            entityId: record.id,
            action: { in: ["REQUEST_APPROVED", "REQUEST_REJECTED"] },
          },
        }),
      ).toBe(1);
      expect(
        await db.outboxEvent.count({ where: { requestId: record.id } }),
      ).toBe(current.status === "APPROVED" ? 1 : 0);
      await switchTo(a, "EMPLOYEE");
    });
    it("RBAC: managers cannot approve their own requests", async () => {
      await switchTo(a, "MANAGER");
      const record = await create(a);
      expect(
        (
          await call(a, "POST", `/api/requests/${record.id}/submit`, {
            version: 1,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await call(a, "POST", `/api/requests/${record.id}/decision`, {
            version: 2,
            decision: "APPROVED",
            comment: "I approve myself",
          })
        ).statusCode,
      ).toBe(403);
      await switchTo(a, "EMPLOYEE");
    });
    it("VALIDATION: rejects invalid amounts, stale draft updates and invalid transitions", async () => {
      expect(
        (
          await call(a, "POST", "/api/requests", {
            ...validInput,
            amountCents: 0,
          })
        ).statusCode,
      ).toBe(400);
      const record = await create(a);
      expect(
        (
          await call(a, "PATCH", `/api/requests/${record.id}`, {
            ...validInput,
            version: 99,
          })
        ).statusCode,
      ).toBe(409);
      await switchTo(a, "MANAGER");
      expect(
        (
          await call(a, "POST", `/api/requests/${record.id}/decision`, {
            version: 1,
            decision: "APPROVED",
            comment: "Not submitted yet",
          })
        ).statusCode,
      ).toBe(409);
      await switchTo(a, "EMPLOYEE");
    });
  });

  describe("database guarantees and contracts", () => {
    it("DELETE: stale deletion conflicts; successful deletion retains one audit entry", async () => {
      const record = await create(a);
      expect(
        (await call(a, "DELETE", `/api/requests/${record.id}`, { version: 2 }))
          .statusCode,
      ).toBe(409);
      expect(
        (
          await call(a, "DELETE", `/api/requests/${record.id}`, { version: 1 })
        ).json(),
      ).toEqual({ deleted: true });
      expect(
        await db.request.findUnique({ where: { id: record.id } }),
      ).toBeNull();
      expect(
        await db.auditEvent.count({
          where: { entityId: record.id, action: "REQUEST_DELETED" },
        }),
      ).toBe(1);
    });

    it("OUTBOX: database failure rolls back decision, audit and intent", async () => {
      const record = await create(a);
      await call(a, "POST", `/api/requests/${record.id}/submit`, {
        version: 1,
      });
      // Deterministic DB fault: duplicate intent violates its unique constraint.
      await owner.outboxEvent.create({
        data: {
          requestId: record.id,
          organizationId: a.organizationId,
          correlationId: "fixture",
        },
      });
      await switchTo(a, "MANAGER");
      const result = await call(
        a,
        "POST",
        `/api/requests/${record.id}/decision`,
        { version: 2, decision: "APPROVED", comment: "Must roll back" },
      );
      expect(result.statusCode).toBe(500);
      expect(
        (await db.request.findUniqueOrThrow({ where: { id: record.id } }))
          .status,
      ).toBe("SUBMITTED");
      expect(
        await db.auditEvent.count({
          where: { entityId: record.id, action: "REQUEST_APPROVED" },
        }),
      ).toBe(0);
      await switchTo(a, "EMPLOYEE");
    });
    it("DATABASE: composite FK rejects an owner from a different tenant", async () => {
      await expect(
        db.request.create({
          data: {
            ...validInput,
            organizationId: a.organizationId,
            ownerId: b.memberId,
          },
        }),
      ).rejects.toThrow();
    });
    it("DATABASE: approved records require a non-null decision comment", async () => {
      await expect(
        db.request.create({
          data: {
            ...validInput,
            organizationId: a.organizationId,
            ownerId: a.memberId,
            status: "APPROVED",
          },
        }),
      ).rejects.toThrow();
    });
    it("RETENTION: runtime cannot forge expiry; purge only removes expired workspaces", async () => {
      const demo = await newDemo();
      const actor = await db.member.findUniqueOrThrow({
        where: { id: demo.memberId },
        include: { organization: true },
      });
      const workspaceId = actor.organization.workspaceId;
      await expect(
        db.workspace.update({
          where: { id: workspaceId },
          data: { expiresAt: new Date(0) },
        }),
      ).rejects.toThrow();
      await db.$queryRaw`SELECT public.purge_expired_demo_workspaces()`;
      expect(
        await db.workspace.findUnique({ where: { id: workspaceId } }),
      ).not.toBeNull();
      await owner.workspace.update({
        where: { id: workspaceId },
        data: { expiresAt: new Date(0) },
      });
      await db.$queryRaw`SELECT public.purge_expired_demo_workspaces()`;
      expect(
        await db.workspace.findUnique({ where: { id: workspaceId } }),
      ).toBeNull();
      expect((await call(a, "GET", "/api/session")).statusCode).toBe(200);
    });
    it("AUDIT: runtime role cannot update, delete or truncate audit events", async () => {
      const record = await create(a);
      const event = await db.auditEvent.findFirstOrThrow({
        where: { entityId: record.id },
      });
      await expect(
        db.auditEvent.update({
          where: { id: event.id },
          data: { action: "FORGED" },
        }),
      ).rejects.toThrow();
      await expect(
        db.auditEvent.delete({ where: { id: event.id } }),
      ).rejects.toThrow();
      await expect(db.$executeRaw`TRUNCATE audit_events`).rejects.toThrow();
      expect(
        (await db.auditEvent.findUniqueOrThrow({ where: { id: event.id } }))
          .action,
      ).toBe("REQUEST_CREATED");
    });
    it("CONTRACT: implementation responses match the published schemas", async () => {
      const record = await create(a);
      expect(RequestRecord.safeParse(record).success).toBe(true);
      const error = await call(
        a,
        "GET",
        `/api/requests/${crypto.randomUUID()}`,
      );
      expect(ErrorResponse.safeParse(error.json()).success).toBe(true);
      const doc = (await call(a, "GET", "/api/openapi.json")).json();
      expect(doc).toEqual(openApiDocument());
      expect(
        doc.paths["/api/requests"].post.responses["200"].content[
          "application/json"
        ].schema,
      ).toEqual(z.toJSONSchema(RequestRecord));
    });
    it("PAGINATION: deterministic cursor pages do not repeat records", async () => {
      const first = (await call(a, "GET", "/api/requests?limit=2")).json();
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBeTruthy();
      const second = (
        await call(
          a,
          "GET",
          `/api/requests?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
        )
      ).json();
      expect(
        second.items.some((r: { id: string }) =>
          first.items.some((x: { id: string }) => r.id === x.id),
        ),
      ).toBe(false);
      expect(
        second.items.every(
          (r: { organizationId: string }) =>
            r.organizationId === a.organizationId,
        ),
      ).toBe(true);
    });
  });
});
