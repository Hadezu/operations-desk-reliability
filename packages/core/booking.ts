import { z } from "zod";
import type { Database } from "./db.js";
import type { Identity } from "./auth.js";
import { hash } from "./auth.js";
import { AppError, denied } from "./errors.js";
export type Booking = {
  id: string;
  resource: string;
  owner: string;
  start: string;
  end: string;
  expires: string;
  status:
    | "HELD"
    | "CONFIRMED"
    | "EXPIRED"
    | "FAILED"
    | "CANCELLED"
    | "REFUND_PENDING"
    | "REFUNDED"
    | "PAYMENT_REVIEW";
};
type Event = {
  id: string;
  booking: string;
  kind: "succeeded" | "failed" | "refunded";
  outcome: "applied" | "deferred" | "ignored" | "review";
};
export type BookingState = { bookings: Booking[]; events: Event[] };
const empty = (): BookingState => ({ bookings: [], events: [] });
function reject(code: string, status = 409): never {
  throw new AppError(status, code, code);
}
const Input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("hold"),
      resource: z.enum(["bike-01", "desk-01", "room-01"]),
      start: z.iso.datetime(),
      end: z.iso.datetime(),
    })
    .strict(),
  z.object({ action: z.literal("cancel"), booking: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("event"),
      booking: z.uuid(),
      event: z.uuid(),
      kind: z.enum(["succeeded", "failed", "refunded"]),
    })
    .strict(),
  z.object({ action: z.literal("refresh") }).strict(),
]);
export function prepareBookingValidation() {
  for (const schema of Input.options) schema.safeParse({});
}
function expire(s: BookingState, now: number) {
  for (const b of s.bookings)
    if (b.status === "HELD" && Date.parse(b.expires) <= now)
      b.status = "EXPIRED";
}
function processEvent(s: BookingState, event: Event) {
  const b = s.bookings.find((b) => b.id === event.booking)!;
  if (event.kind === "succeeded") {
    if (b.status === "HELD") {
      b.status = "CONFIRMED";
      event.outcome = "applied";
    } else if (["EXPIRED", "CANCELLED", "FAILED"].includes(b.status)) {
      b.status = "PAYMENT_REVIEW";
      event.outcome = "review";
    } else event.outcome = "ignored";
  } else if (event.kind === "failed") {
    if (b.status === "HELD") {
      b.status = "FAILED";
      event.outcome = "applied";
    } else event.outcome = "ignored";
  } else {
    if (["CONFIRMED", "REFUND_PENDING", "PAYMENT_REVIEW"].includes(b.status)) {
      b.status = "REFUNDED";
      event.outcome = "applied";
    } else event.outcome = b.status === "REFUNDED" ? "ignored" : "deferred";
  }
  // A refund delivered before success remains durable and is reconsidered.
  if (b.status === "CONFIRMED" || b.status === "PAYMENT_REVIEW")
    for (const earlier of s.events.filter(
      (e) =>
        e.booking === b.id && e.kind === "refunded" && e.outcome === "deferred",
    )) {
      b.status = "REFUNDED";
      earlier.outcome = "applied";
    }
}
export async function bookingView(db: Database, actor: Identity) {
  const rows = await db.$queryRaw<
    { revision: number; state: BookingState }[]
  >`SELECT revision,state FROM booking_revisions WHERE organization_id=${actor.organizationId}::uuid ORDER BY revision DESC LIMIT 1`;
  const state = rows[0]?.state ?? empty();
  const [{ now }] = await db.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  expire(state, now.getTime());
  const history = await db.$queryRaw<
    {
      revision: number;
      operation: string;
      outcome: unknown;
      created_at: Date;
    }[]
  >`SELECT revision,operation,outcome,created_at FROM booking_revisions WHERE organization_id=${actor.organizationId}::uuid ORDER BY revision DESC`;
  return {
    ...state,
    revision: rows[0]?.revision ?? 0,
    history,
    now: now.toISOString(),
  };
}
export async function bookingCommand(
  db: Database,
  actor: Identity,
  raw: unknown,
  key: string | null,
  holdMs = 120000,
) {
  if (actor.role === "OBSERVER") denied();
  const input = Input.parse(raw);
  if (input.action === "event" && actor.role !== "MANAGER") denied();
  if (!key || !/^[\w-]{8,100}$/.test(key))
    reject("INVALID_IDEMPOTENCY_KEY", 400);
  const fingerprint = await hash(JSON.stringify(input));
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id=${actor.organizationId}::uuid FOR UPDATE`;
    const prior = await tx.$queryRaw<
      { fingerprint: string; outcome: unknown }[]
    >`SELECT fingerprint,outcome FROM booking_revisions WHERE organization_id=${actor.organizationId}::uuid AND actor_id=${actor.memberId}::uuid AND command_key=${key}`;
    if (prior.length) {
      if (prior[0].fingerprint !== fingerprint) reject("IDEMPOTENCY_MISMATCH");
      return prior[0].outcome;
    }
    const rows = await tx.$queryRaw<
      { revision: number; state: BookingState }[]
    >`SELECT revision,state FROM booking_revisions WHERE organization_id=${actor.organizationId}::uuid ORDER BY revision DESC LIMIT 1`;
    const [{ now }] = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    const s = rows[0]?.state ?? empty();
    const revision = (rows[0]?.revision ?? 0) + 1;
    if (revision > 200) reject("DEMO_LIMIT", 429);
    expire(s, now.getTime());
    let booking: string | undefined;
    if (input.action === "hold") {
      const start = Date.parse(input.start),
        end = Date.parse(input.end);
      if (
        start < now.getTime() ||
        end <= start ||
        end - start > 86400000 ||
        start - now.getTime() > 365 * 86400000
      )
        reject("INVALID_INTERVAL", 400);
      if (
        s.bookings.some(
          (b) =>
            b.resource === input.resource &&
            ["HELD", "CONFIRMED"].includes(b.status) &&
            Date.parse(b.start) < end &&
            Date.parse(b.end) > start,
        )
      )
        reject("RESOURCE_UNAVAILABLE");
      if (s.bookings.length >= 50) reject("DEMO_LIMIT", 429);
      booking = crypto.randomUUID();
      s.bookings.push({
        id: booking,
        resource: input.resource,
        owner: actor.memberId,
        start: input.start,
        end: input.end,
        expires: new Date(now.getTime() + holdMs).toISOString(),
        status: "HELD",
      });
    } else if (input.action === "cancel") {
      const b = s.bookings.find((b) => b.id === input.booking);
      if (!b) reject("BOOKING_NOT_FOUND", 404);
      if (actor.role !== "MANAGER" && b.owner !== actor.memberId) denied();
      if (b.status === "HELD") b.status = "CANCELLED";
      else if (b.status === "CONFIRMED") b.status = "REFUND_PENDING";
      else if (!["CANCELLED", "REFUND_PENDING", "REFUNDED"].includes(b.status))
        reject("INVALID_TRANSITION");
      booking = b.id;
    } else if (input.action === "event") {
      const b = s.bookings.find((b) => b.id === input.booking);
      if (!b) reject("BOOKING_NOT_FOUND", 404);
      const old = s.events.find((e) => e.id === input.event);
      if (old && (old.booking !== input.booking || old.kind !== input.kind))
        reject("EVENT_CONFLICT");
      if (!old) {
        const event: Event = {
          id: input.event,
          booking: input.booking,
          kind: input.kind,
          outcome: "deferred",
        };
        s.events.push(event);
        processEvent(s, event);
      }
      if (s.events.length > 100) reject("DEMO_LIMIT", 429);
      booking = b.id;
    }
    const outcome = {
      revision,
      action: input.action,
      booking: booking ?? null,
    };
    await tx.$executeRaw`INSERT INTO booking_revisions(organization_id,revision,actor_id,operation,command_key,fingerprint,state,outcome) VALUES(${actor.organizationId}::uuid,${revision},${actor.memberId}::uuid,${input.action},${key},${fingerprint},${JSON.stringify(s)}::jsonb,${JSON.stringify(outcome)}::jsonb)`;
    return outcome;
  });
}
