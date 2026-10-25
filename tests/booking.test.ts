import "dotenv/config";
import { afterAll, expect, it } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { connectDatabase } from "../packages/core/db";
import { startDemo, type Identity } from "../packages/core/auth";
import {
  bookingCommand as command,
  bookingView as view,
} from "../packages/core/booking";
const db = connectDatabase(process.env.DATABASE_URL!);
afterAll(() => db.$disconnect());
async function fixture() {
  const demo = await startDemo(db);
  const employee = demo.identity;
  const manager = {
    ...employee,
    role: "MANAGER",
    memberId: demo.organizations[0].members.find((m) => m.role === "MANAGER")!
      .id,
  } as Identity;
  return { employee, manager };
}
const interval = () => ({
  action: "hold",
  resource: "bike-01",
  start: new Date(Date.now() + 3600000).toISOString(),
  end: new Date(Date.now() + 7200000).toISOString(),
});
const call = (
  a: Identity,
  input: unknown,
  key = crypto.randomUUID(),
  ttl = 120000,
) => command(db, a, input, key, ttl);
async function hold(a: Identity, ttl = 120000) {
  await call(a, interval(), crypto.randomUUID(), ttl);
  return (await view(db, a)).bookings.at(-1)!;
}
async function event(
  a: Identity,
  booking: string,
  kind: string,
  id = crypto.randomUUID(),
) {
  return call(a, { action: "event", booking, kind, event: id });
}
it("two users competing for the last resource produce exactly one reservation", async () => {
  const { employee, manager } = await fixture();
  const input = interval();
  const result = await Promise.allSettled([
    call(employee, input),
    call(manager, input),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await view(db, manager)).bookings).toHaveLength(1);
});
it("same command concurrently returns original receipt; changed payload conflicts", async () => {
  const { manager } = await fixture();
  const input = interval(),
    key = crypto.randomUUID();
  const r = await Promise.all([
    call(manager, input, key),
    call(manager, input, key),
  ]);
  expect(r[0]).toEqual(r[1]);
  expect((await view(db, manager)).bookings).toHaveLength(1);
  await expect(
    call(manager, { ...input, resource: "desk-01" }, key),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
});
it("hold expires against database time and releases the interval; late success is a review case", async () => {
  const { manager } = await fixture();
  const b = await hold(manager, 30);
  await delay(60);
  expect((await view(db, manager)).bookings[0].status).toBe("EXPIRED");
  await call(manager, { ...interval(), start: b.start, end: b.end });
  await event(manager, b.id, "succeeded");
  const s = await view(db, manager);
  expect(s.bookings[0].status).toBe("PAYMENT_REVIEW");
  expect(s.bookings[1].status).toBe("HELD");
});
it("declined payment releases resource; failure after success cannot undo confirmation", async () => {
  const { manager } = await fixture();
  const b = await hold(manager);
  await event(manager, b.id, "failed");
  expect((await view(db, manager)).bookings[0].status).toBe("FAILED");
  const next = await hold(manager);
  await event(manager, next.id, "succeeded");
  await event(manager, next.id, "failed");
  expect((await view(db, manager)).bookings[1].status).toBe("CONFIRMED");
});
it("duplicate simulator event is retained once and conflicting event identity is rejected", async () => {
  const { manager } = await fixture();
  const b = await hold(manager),
    id = crypto.randomUUID();
  await event(manager, b.id, "succeeded", id);
  await event(manager, b.id, "succeeded", id);
  const s = await view(db, manager);
  expect(s.events).toHaveLength(1);
  expect(s.bookings[0].status).toBe("CONFIRMED");
  await expect(event(manager, b.id, "refunded", id)).rejects.toMatchObject({
    code: "EVENT_CONFLICT",
  });
});
it("out-of-order refund waits durably then resolves after success; late success cannot resurrect refund", async () => {
  const { manager } = await fixture();
  const b = await hold(manager);
  await event(manager, b.id, "refunded");
  expect((await view(db, manager)).events[0].outcome).toBe("deferred");
  await event(manager, b.id, "succeeded");
  await event(manager, b.id, "succeeded");
  const s = await view(db, manager);
  expect(s.bookings[0].status).toBe("REFUNDED");
  expect(s.events[0].outcome).toBe("applied");
});
it("cancellation creates refund-pending state, simulator closes it; unauthorized writes fail", async () => {
  const { manager, employee } = await fixture();
  const b = await hold(manager);
  await expect(
    call(employee, { action: "cancel", booking: b.id }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(event(employee, b.id, "succeeded")).rejects.toMatchObject({
    status: 403,
  });
  await event(manager, b.id, "succeeded");
  await call(manager, { action: "cancel", booking: b.id });
  expect((await view(db, manager)).bookings[0].status).toBe("REFUND_PENDING");
  await event(manager, b.id, "refunded");
  expect((await view(db, manager)).bookings[0].status).toBe("REFUNDED");
  const other = await fixture();
  await expect(
    call(other.manager, { action: "cancel", booking: b.id }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    call({ ...manager, role: "OBSERVER" }, interval()),
  ).rejects.toMatchObject({ status: 403 });
});
it("rejects invalid intervals and database overwrites", async () => {
  const { manager } = await fixture();
  await expect(
    call(manager, { ...interval(), end: new Date(0).toISOString() }),
  ).rejects.toMatchObject({ status: 400 });
  await hold(manager);
  await expect(
    db.$executeRaw`UPDATE booking_revisions SET operation='overwrite' WHERE organization_id=${manager.organizationId}::uuid`,
  ).rejects.toThrow();
});
