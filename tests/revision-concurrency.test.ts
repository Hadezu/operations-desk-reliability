import "dotenv/config";
import { afterAll, expect, it } from "vitest";
import { connectDatabase } from "../packages/core/db";
import { connectEdgeDatabase } from "../packages/core/edge-db";
import { startDemo, type Identity } from "../packages/core/auth";
import { revisionCommand } from "../packages/core/revision-command";
const db = connectDatabase(process.env.DATABASE_URL!);
const edge = connectEdgeDatabase(process.env.DATABASE_URL!, 5);
afterAll(async () => {
  await db.$disconnect();
  await edge.$disconnect();
});
async function actor() {
  const s = await startDemo(db);
  return {
    ...s.identity,
    memberId: s.organizations[0].members.find((m) => m.role === "MANAGER")!.id,
    role: "MANAGER",
  } as Identity;
}
function barrier() {
  let count = 0;
  let release!: () => void;
  const ready = new Promise<void>((r) => (release = r));
  return async () => {
    if (++count === 2) release();
    await ready;
  };
}
async function history(a: Identity) {
  return db.$queryRaw<
    { revision: number; state: { count: number }; command_key: string }[]
  >`SELECT revision,state,command_key FROM association_revisions WHERE organization_id=${a.organizationId}::uuid ORDER BY revision`;
}
it("two separate connections recompute a losing snapshot instead of losing an update", async () => {
  const a = await actor(),
    wait = barrier();
  let calls = 0;
  const reduce = async (s: { count: number }, revision: number) => {
    if (++calls <= 2) await wait();
    s.count++;
    return { revision };
  };
  await Promise.all(
    [db, edge].map((client) =>
      revisionCommand(
        client,
        a,
        "association",
        crypto.randomUUID(),
        "fingerprint",
        "counter",
        () => ({ count: 0 }),
        reduce,
      ),
    ),
  );
  const rows = await history(a);
  expect(rows.map((r) => r.state.count)).toEqual([1, 2]);
  expect(calls).toBe(3);
});
it("a same-key race returns one committed receipt across independent adapters", async () => {
  const a = await actor(),
    wait = barrier(),
    key = crypto.randomUUID();
  const reduce = async (s: { count: number }, revision: number) => {
    await wait();
    s.count++;
    return { revision, nonce: crypto.randomUUID() };
  };
  const receipts = await Promise.all(
    [db, edge].map((client) =>
      revisionCommand(
        client,
        a,
        "association",
        key,
        "fingerprint",
        "counter",
        () => ({ count: 0 }),
        reduce,
      ),
    ),
  );
  expect(receipts[0]).toEqual(receipts[1]);
  expect(await history(a)).toHaveLength(1);
});
it("a failing reducer leaves no partial state or successful receipt", async () => {
  const a = await actor();
  await expect(
    revisionCommand(
      db,
      a,
      "association",
      crypto.randomUUID(),
      "fingerprint",
      "counter",
      () => ({ count: 0 }),
      async (s) => {
        s.count = 99;
        throw Error("validation rejected");
      },
    ),
  ).rejects.toThrow("validation rejected");
  expect(await history(a)).toHaveLength(0);
});
it("retry exhaustion is bounded and does not write the losing command", async () => {
  const a = await actor(),
    key = crypto.randomUUID();
  let conflicts = 0;
  await expect(
    revisionCommand(
      db,
      a,
      "association",
      key,
      "fingerprint",
      "counter",
      () => ({ count: 0 }),
      async (s, revision) => {
        conflicts++;
        await revisionCommand(
          edge,
          a,
          "association",
          crypto.randomUUID(),
          "other",
          "counter",
          () => ({ count: 0 }),
          async (current) => {
            current.count++;
            return { revision };
          },
        );
        s.count = 999;
        return { revision };
      },
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  const rows = await history(a);
  expect(conflicts).toBe(3);
  expect(rows.at(-1)?.state.count).toBe(3);
  expect(rows.some((r) => r.command_key === key)).toBe(false);
});
