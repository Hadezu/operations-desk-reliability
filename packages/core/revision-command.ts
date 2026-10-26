import type { Database } from "./db.js";
import type { Identity } from "./auth.js";
import { AppError } from "./errors.js";

type Snapshot<S> = {
  latest: { revision: number; state: S } | null;
  receipt: { fingerprint: string; outcome: unknown } | null;
  now: Date;
};
// One snapshot read and one atomic append. The existing (organization, revision)
// primary key is a compare-and-swap: only one writer can append revision n+1.
// A losing writer must reread AND recompute, never reuse its stale state.
// State and the idempotency receipt are the same immutable database row.
export async function revisionCommand<S>(
  db: Database,
  actor: Identity,
  module: "association" | "booking",
  key: string,
  fingerprint: string,
  operation: string,
  empty: () => S,
  reduce: (state: S, revision: number, now: Date) => Promise<unknown>,
): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    // Both subqueries use a single statement snapshot. Separate receipt/state
    // reads could mistake a concurrently applied replay for an invalid command.
    const rows =
      module === "association"
        ? await db.$queryRaw<
            Snapshot<S>[]
          >`SELECT (SELECT jsonb_build_object('revision',revision,'state',state) FROM association_revisions WHERE organization_id=${actor.organizationId}::uuid ORDER BY revision DESC LIMIT 1) AS latest, (SELECT jsonb_build_object('fingerprint',fingerprint,'outcome',outcome) FROM association_revisions WHERE organization_id=${actor.organizationId}::uuid AND actor_id=${actor.memberId}::uuid AND command_key=${key}) AS receipt, clock_timestamp() AS now`
        : await db.$queryRaw<
            Snapshot<S>[]
          >`SELECT (SELECT jsonb_build_object('revision',revision,'state',state) FROM booking_revisions WHERE organization_id=${actor.organizationId}::uuid ORDER BY revision DESC LIMIT 1) AS latest, (SELECT jsonb_build_object('fingerprint',fingerprint,'outcome',outcome) FROM booking_revisions WHERE organization_id=${actor.organizationId}::uuid AND actor_id=${actor.memberId}::uuid AND command_key=${key}) AS receipt, clock_timestamp() AS now`;
    const snapshot = rows[0];
    if (snapshot.receipt) {
      if (snapshot.receipt.fingerprint !== fingerprint)
        throw new AppError(409, "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_MISMATCH");
      return snapshot.receipt.outcome;
    }
    const revision = (snapshot.latest?.revision ?? 0) + 1;
    if (revision > 200) throw new AppError(429, "DEMO_LIMIT", "DEMO_LIMIT");
    const state = snapshot.latest?.state ?? empty();
    const outcome = await reduce(state, revision, snapshot.now);
    let inserted: number;
    if (module === "association") {
      inserted =
        await db.$executeRaw`INSERT INTO association_revisions(organization_id,revision,actor_id,operation,command_key,fingerprint,state,outcome) VALUES(${actor.organizationId}::uuid,${revision},${actor.memberId}::uuid,${operation},${key},${fingerprint},${JSON.stringify(state)}::jsonb,${JSON.stringify(outcome)}::jsonb) ON CONFLICT DO NOTHING`;
    } else {
      inserted =
        await db.$executeRaw`INSERT INTO booking_revisions(organization_id,revision,actor_id,operation,command_key,fingerprint,state,outcome) VALUES(${actor.organizationId}::uuid,${revision},${actor.memberId}::uuid,${operation},${key},${fingerprint},${JSON.stringify(state)}::jsonb,${JSON.stringify(outcome)}::jsonb) ON CONFLICT DO NOTHING`;
    }
    if (inserted === 1) return outcome;
  }
  throw new AppError(
    409,
    "VERSION_CONFLICT",
    "Concurrent update; retry with the same idempotency key.",
  );
}
