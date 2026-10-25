import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../packages/core/db";
import { connectEdgeDatabase } from "../packages/core/edge-db";
import { startDemo, type Identity } from "../packages/core/auth";
import {
  associationCommand as command,
  associationView as view,
  memberSample,
  paymentSample,
  previewMembers,
  accountingCsv,
} from "../packages/core/association";
import { handleApi } from "../packages/core/http";
import { bookingCommand } from "../packages/core/booking";
const db = connectDatabase(process.env.DATABASE_URL!);
const edge = connectEdgeDatabase(process.env.DATABASE_URL!, 5);
const owner = connectDatabase(process.env.MIGRATION_DATABASE_URL!);
afterAll(async () => {
  await db.$disconnect();
  await edge.$disconnect();
  await owner.$disconnect();
});
async function fixture() {
  const s = await startDemo(db);
  const manager = s.organizations[0].members.find((m) => m.role === "MANAGER")!;
  const actor: Identity = {
    ...s.identity,
    memberId: manager.id,
    role: "MANAGER",
  };
  return { s, actor };
}
const call = (actor: Identity, input: unknown, key = crypto.randomUUID()) =>
  command(db, actor, input, key);
async function seed(actor: Identity) {
  await call(actor, { action: "preview", csv: memberSample });
  const p = (await view(db, actor)).plans[0];
  await call(actor, {
    action: "apply",
    plan: p.id,
    digest: p.digest,
    rows: [2, 3, 4],
  });
}
describe("Association real PostgreSQL", () => {
  it("rejects a preview after a change-and-change-back and normalizes email case", async () => {
    const { actor } = await fixture();
    await seed(actor);
    await call(actor, { action: "preview", csv: memberSample });
    const p = (await view(db, actor)).plans.at(-1)!;
    await call(actor, { action: "status", id: "M001", status: "paused" });
    await call(actor, { action: "status", id: "M001", status: "active" });
    await expect(
      call(actor, { action: "apply", plan: p.id, digest: p.digest, rows: [2] }),
    ).rejects.toMatchObject({ code: "STALE_PLAN" });
    expect(
      previewMembers(
        memberSample.replace("anna@example.invalid", "ANNA@example.invalid"),
        [],
      )[3].issue,
    ).toBe("DUPLICATE_MEMBER");
  });
  it("expired synthetic workspaces purge both modules without weakening live immutability", async () => {
    const { actor } = await fixture();
    await seed(actor);
    await bookingCommand(
      db,
      actor,
      {
        action: "hold",
        resource: "bike-01",
        start: new Date(Date.now() + 3600000).toISOString(),
        end: new Date(Date.now() + 7200000).toISOString(),
      },
      crypto.randomUUID(),
    );
    await owner.$executeRaw`UPDATE workspaces SET expires_at=now()-interval '1 minute' WHERE id=${actor.workspaceId}::uuid`;
    await db.$queryRaw`SELECT public.purge_expired_demo_workspaces()`;
    const rows = await db.$queryRaw<
      unknown[]
    >`SELECT 1 FROM association_revisions WHERE organization_id=${actor.organizationId}::uuid`;
    expect(rows).toHaveLength(0);
    const bookings = await db.$queryRaw<
      unknown[]
    >`SELECT 1 FROM booking_revisions WHERE organization_id=${actor.organizationId}::uuid`;
    expect(bookings).toHaveLength(0);
  });
  it("classifies duplicate and invalid rows; rejects unsupported CSV and non-synthetic identities", () => {
    expect(previewMembers(memberSample, []).map((r) => r.issue)).toEqual([
      null,
      null,
      null,
      "DUPLICATE_MEMBER",
      "INVALID_MEMBER",
    ]);
    expect(() => previewMembers("wrong\n1", [])).toThrow();
    expect(
      previewMembers(
        memberSample.replace("anna@example.invalid", "anna@real.test"),
        [],
      )[0].issue,
    ).toBe("INVALID_MEMBER");
  });
  it("preview is non-mutating; selected import and same-key retry create one revision", async () => {
    const { actor } = await fixture();
    await call(actor, { action: "preview", csv: memberSample });
    let s = await view(db, actor);
    expect(s.members).toHaveLength(0);
    const p = s.plans[0];
    const input = {
      action: "apply",
      plan: p.id,
      digest: p.digest,
      rows: [2, 3, 4],
    };
    const key = crypto.randomUUID();
    const outcomes = await Promise.all([
      call(actor, input, key),
      call(actor, input, key),
    ]);
    expect(outcomes[0]).toEqual(outcomes[1]);
    s = await view(db, actor);
    expect(s.members).toHaveLength(3);
    expect(s.history).toHaveLength(2);
    await expect(
      call(actor, { ...input, rows: [2] }, key),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });
  it("rejects invalid selection atomically and rejects stale plans", async () => {
    const { actor } = await fixture();
    await seed(actor);
    await call(actor, { action: "preview", csv: memberSample });
    const p = (await view(db, actor)).plans.at(-1)!;
    await expect(
      call(actor, {
        action: "apply",
        plan: p.id,
        digest: p.digest,
        rows: [2, 6],
      }),
    ).rejects.toMatchObject({ code: "INVALID_SELECTION" });
    expect((await view(db, actor)).revision).toBe(3);
    await call(actor, { action: "status", id: "M001", status: "paused" });
    await expect(
      call(actor, { action: "apply", plan: p.id, digest: p.digest, rows: [2] }),
    ).rejects.toMatchObject({ code: "STALE_PLAN" });
  });
  it("updates selected members while retaining prior state; paused members do not get new charges", async () => {
    const { actor } = await fixture();
    await seed(actor);
    await call(actor, {
      action: "preview",
      csv: memberSample.replace("Demo Anna", "Demo Anna Updated"),
    });
    const p = (await view(db, actor)).plans.at(-1)!;
    await call(actor, {
      action: "apply",
      plan: p.id,
      digest: p.digest,
      rows: [2],
    });
    await call(actor, { action: "status", id: "M001", status: "paused" });
    await call(actor, { action: "charges", period: "2026-10" });
    const s = await view(db, actor);
    expect(s.members[0].name).toBe("Demo Anna Updated");
    expect(s.charges.map((c) => c.member)).toEqual(["M002", "M003"]);
    const old = await db.$queryRaw<
      { state: { members: { name: string }[] } }[]
    >`SELECT state FROM association_revisions WHERE organization_id=${actor.organizationId}::uuid AND revision=2`;
    expect(old[0].state.members[0].name).toBe("Demo Anna");
  });
  it("concurrent charges and repeated bank import never duplicate financial entries", async () => {
    const { actor } = await fixture();
    await seed(actor);
    await Promise.all([
      call(actor, { action: "charges", period: "2026-10" }),
      call(actor, { action: "charges", period: "2026-10" }),
    ]);
    await call(actor, { action: "payments", csv: paymentSample });
    await call(actor, { action: "payments", csv: paymentSample });
    await call(actor, { action: "reconcile" });
    await call(actor, { action: "reconcile" });
    let s = await view(db, actor);
    expect(s.charges).toHaveLength(3);
    expect(s.payments).toHaveLength(4);
    expect(s.allocations).toHaveLength(2);
    expect(s.discrepancies).toHaveLength(2);
    await expect(
      call(actor, {
        action: "payments",
        csv: paymentSample.replace("M001,12000", "M001,12001"),
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_CONFLICT" });
    await call(actor, {
      action: "resolve",
      payment: "BANK002",
      charge: "M003/2026-10",
    });
    await expect(
      call(actor, {
        action: "resolve",
        payment: "BANK002",
        charge: "M001/2026-10",
      }),
    ).rejects.toMatchObject({ code: "ALLOCATION_CONFLICT" });
    s = await view(db, actor);
    expect(s.allocations).toHaveLength(3);
    expect(accountingCsv(s)).toContain("BANK001,paid");
    expect(s.discrepancies[0].id).toBe("BANK004");
  });
  it("ambiguous exact reference is queued across periods; amount mismatch rejected", async () => {
    const { actor } = await fixture();
    await seed(actor);
    for (const period of ["2026-10", "2026-11"])
      await call(actor, { action: "charges", period });
    await call(actor, { action: "payments", csv: paymentSample });
    await call(actor, { action: "reconcile" });
    const s = await view(db, actor);
    expect(s.allocations).toHaveLength(0);
    expect(s.discrepancies[0].candidates).toHaveLength(2);
    await expect(
      call(actor, {
        action: "resolve",
        payment: "BANK004",
        charge: "M001/2026-10",
      }),
    ).rejects.toMatchObject({ code: "ALLOCATION_CONFLICT" });
  });
  it("documents are retained in both languages without mail and role/tenant violations fail", async () => {
    const { actor } = await fixture();
    await seed(actor);
    for (const language of ["de", "pl"])
      for (const kind of ["notice", "welcome", "reminder"])
        await call(actor, {
          action: "document",
          member: "M001",
          kind,
          language,
        });
    expect((await view(db, actor)).documents).toHaveLength(6);
    await expect(
      call(
        { ...actor, role: "OBSERVER" },
        { action: "charges", period: "2026-10" },
      ),
    ).rejects.toMatchObject({ status: 403 });
    const other = await fixture();
    expect((await view(db, other.actor)).members).toHaveLength(0);
    await expect(
      call(other.actor, {
        action: "resolve",
        payment: "BANK001",
        charge: "M001/2026-10",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("database rejects update/delete; insert failure rolls back; edge adapter works", async () => {
    const { actor } = await fixture();
    await seed(actor);
    await expect(
      db.$executeRaw`UPDATE association_revisions SET operation='tampered' WHERE organization_id=${actor.organizationId}::uuid`,
    ).rejects.toThrow();
    await expect(
      owner.$executeRaw`DELETE FROM association_revisions WHERE organization_id=${actor.organizationId}::uuid`,
    ).rejects.toThrow();
    const before = await view(db, actor);
    await expect(
      command(
        db,
        { ...actor, memberId: crypto.randomUUID() },
        { action: "charges", period: "2026-10" },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow();
    expect((await view(db, actor)).revision).toBe(before.revision);
    await command(
      edge,
      actor,
      { action: "charges", period: "2026-10" },
      crypto.randomUUID(),
    );
    expect((await view(edge, actor)).charges).toHaveLength(3);
  });
  it("HTTP validates session, CSRF, roles, unknown fields and foreign preview IDs", async () => {
    const { s, actor } = await fixture();
    const options = {
      db,
      origin: "http://localhost:3100",
      backgroundMode: "disabled" as const,
    };
    const req = (payload: unknown, csrf = s.csrfToken) =>
      new Request("http://localhost:3100/api/association", {
        method: "POST",
        headers: {
          origin: options.origin,
          cookie: `desk_session=${s.sessionToken}`,
          "x-csrf-token": csrf,
          "idempotency-key": crypto.randomUUID(),
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    expect(
      (await handleApi(req({ action: "charges", period: "2026-10" }), options))
        .status,
    ).toBe(403);
    expect(
      (
        await handleApi(
          req({ action: "charges", period: "2026-10" }, "bad"),
          options,
        )
      ).status,
    ).toBe(403);
    await db.$executeRaw`UPDATE sessions SET member_id=${actor.memberId}::uuid WHERE token_hash=${actor.tokenHash}`;
    expect(
      (
        await handleApi(
          req({
            action: "charges",
            period: "2026-10",
            organizationId: "forged",
          }),
          options,
        )
      ).status,
    ).toBe(400);
    expect(
      (await handleApi(req({ action: "preview", csv: memberSample }), options))
        .status,
    ).toBe(200);
    expect(
      (
        await handleApi(
          req({
            action: "apply",
            plan: crypto.randomUUID(),
            digest: "0".repeat(64),
            rows: [2],
          }),
          options,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleApi(
          new Request("http://localhost:3100/api/association"),
          options,
        )
      ).status,
    ).toBe(401);
  });
});
