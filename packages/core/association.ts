import { z } from "zod";
import type { Database } from "./db.js";
import type { Identity } from "./auth.js";
import { hash } from "./auth.js";
import { AppError, denied } from "./errors.js";

export {
  memberSample,
  paymentSample,
} from "../contracts/association-fixtures.js";
const Member = z
  .object({
    id: z.string().regex(/^M[0-9]{3,6}$/),
    name: z
      .string()
      .min(2)
      .max(80)
      .regex(/^Demo /),
    email: z.email().endsWith("@example.invalid"),
    category: z.enum(["regular", "reduced"]),
    status: z.enum(["active", "paused", "left"]),
  })
  .strict();
type MemberRow = z.infer<typeof Member>;
type Charge = { id: string; member: string; period: string; cents: number };
type Payment = { id: string; reference: string; cents: number };
type PreviewRow = {
  row: number;
  member: MemberRow | null;
  issue: string | null;
};
type Plan = {
  id: string;
  digest: string;
  baseline: string;
  rows: PreviewRow[];
  applied: boolean;
};
export type AssociationState = {
  memberVersion: number;
  members: MemberRow[];
  charges: Charge[];
  payments: Payment[];
  allocations: { payment: string; charge: string }[];
  plans: Plan[];
  documents: {
    id: string;
    kind: string;
    member: string;
    language: string;
    text: string;
  }[];
};
const empty = (): AssociationState => ({
  memberVersion: 0,
  members: [],
  charges: [],
  payments: [],
  allocations: [],
  plans: [],
  documents: [],
});
function fail(code: string, status = 409): never {
  throw new AppError(status, code, code);
}
// Deliberately bounded CSV dialect: UTF-8 comma-separated, no quoted fields.
// Reject unsupported quoting instead of silently corrupting imported values.
export function csvRows(csv: string, header: string): string[][] {
  if (csv.length > 10000 || csv.includes('"') || csv.includes("\0"))
    fail("CSV_FORMAT", 400);
  const lines = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  if (lines.shift() !== header || lines.length < 1 || lines.length > 50)
    fail("CSV_FORMAT", 400);
  const width = header.split(",").length;
  return lines.map((line) => {
    const cells = line.split(",").map((x) => x.trim());
    if (cells.length !== width) fail("CSV_FORMAT", 400);
    return cells;
  });
}
export function previewMembers(
  csv: string,
  existing: MemberRow[],
): PreviewRow[] {
  const rows = csvRows(csv, "id,name,email,category,status");
  const ids = new Set<string>();
  const emails = new Set<string>();
  return rows.map((cells, index) => {
    const parsed = Member.safeParse(
      Object.fromEntries(
        ["id", "name", "email", "category", "status"].map((k, i) => [
          k,
          k === "email" ? cells[i].toLowerCase() : cells[i],
        ]),
      ),
    );
    if (!parsed.success)
      return { row: index + 2, member: null, issue: "INVALID_MEMBER" };
    const m = parsed.data;
    const conflict =
      ids.has(m.id) ||
      emails.has(m.email) ||
      existing.some((e) => e.email === m.email && e.id !== m.id);
    ids.add(m.id);
    emails.add(m.email);
    return {
      row: index + 2,
      member: m,
      issue: conflict ? "DUPLICATE_MEMBER" : null,
    };
  });
}
export function discrepancies(s: AssociationState) {
  return s.payments
    .filter((p) => !s.allocations.some((a) => a.payment === p.id))
    .map((p) => ({
      ...p,
      candidates: s.charges
        .filter(
          (c) =>
            c.cents === p.cents &&
            !s.allocations.some((a) => a.charge === c.id) &&
            (!p.reference || c.member === p.reference),
        )
        .map((c) => c.id),
    }));
}
export async function associationView(db: Database, actor: Identity) {
  const rows = await db.$queryRaw<
    { revision: number; state: AssociationState }[]
  >`SELECT revision,state FROM association_revisions WHERE organization_id=${actor.organizationId}::uuid ORDER BY revision DESC LIMIT 1`;
  const state = rows[0]?.state ?? empty();
  const history = await db.$queryRaw<
    {
      revision: number;
      operation: string;
      created_at: Date;
      outcome: unknown;
    }[]
  >`SELECT revision,operation,created_at,outcome FROM association_revisions WHERE organization_id=${actor.organizationId}::uuid ORDER BY revision DESC`;
  return {
    revision: rows[0]?.revision ?? 0,
    ...state,
    discrepancies: discrepancies(state),
    history,
  };
}
const Input = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("preview"), csv: z.string().max(10000) })
    .strict(),
  z
    .object({
      action: z.literal("apply"),
      plan: z.uuid(),
      digest: z.string().length(64),
      rows: z.array(z.number().int()).min(1).max(50),
    })
    .strict(),
  z
    .object({
      action: z.literal("status"),
      id: Member.shape.id,
      status: Member.shape.status,
    })
    .strict(),
  z
    .object({
      action: z.literal("charges"),
      period: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
    })
    .strict(),
  z
    .object({ action: z.literal("payments"), csv: z.string().max(10000) })
    .strict(),
  z.object({ action: z.literal("reconcile") }).strict(),
  z
    .object({
      action: z.literal("resolve"),
      payment: z.string().max(40),
      charge: z.string().max(40),
    })
    .strict(),
  z
    .object({
      action: z.literal("document"),
      member: Member.shape.id,
      kind: z.enum(["notice", "welcome", "reminder"]),
      language: z.enum(["de", "pl"]),
    })
    .strict(),
]);
export async function associationCommand(
  db: Database,
  actor: Identity,
  raw: unknown,
  key: string | null,
) {
  if (actor.role !== "MANAGER") denied();
  if (!key || !/^[\w-]{8,100}$/.test(key)) fail("INVALID_IDEMPOTENCY_KEY", 400);
  const input = Input.parse(raw);
  const fingerprint = await hash(JSON.stringify(input));
  return db.$transaction(async (tx) => {
    // Serialize this bounded organization's commands, including distinct retry keys.
    await tx.$queryRaw`SELECT id FROM organizations WHERE id=${actor.organizationId}::uuid FOR UPDATE`;
    const receipts = await tx.$queryRaw<
      { fingerprint: string; outcome: unknown }[]
    >`SELECT fingerprint,outcome FROM association_revisions WHERE organization_id=${actor.organizationId}::uuid AND actor_id=${actor.memberId}::uuid AND command_key=${key}`;
    if (receipts.length) {
      if (receipts[0].fingerprint !== fingerprint) fail("IDEMPOTENCY_MISMATCH");
      return receipts[0].outcome;
    }
    const rows = await tx.$queryRaw<
      { revision: number; state: AssociationState }[]
    >`SELECT revision,state FROM association_revisions WHERE organization_id=${actor.organizationId}::uuid ORDER BY revision DESC LIMIT 1`;
    const revision = (rows[0]?.revision ?? 0) + 1;
    if (revision > 200) fail("DEMO_LIMIT", 429);
    const s = rows[0]?.state ?? empty();
    let detail: unknown = {};
    if (input.action === "preview") {
      if (s.plans.length >= 20) fail("DEMO_LIMIT", 429);
      const planRows = previewMembers(input.csv, s.members);
      const baseline = await hash(JSON.stringify([s.memberVersion, s.members]));
      const plan = {
        id: crypto.randomUUID(),
        digest: await hash(JSON.stringify(planRows)),
        baseline,
        rows: planRows,
        applied: false,
      };
      s.plans.push(plan);
      detail = { plan: plan.id };
    } else if (input.action === "apply") {
      const plan = s.plans.find((p) => p.id === input.plan);
      if (!plan || plan.digest !== input.digest) fail("PLAN_NOT_FOUND", 404);
      if (plan.applied) fail("PLAN_APPLIED");
      if (
        plan.baseline !==
        (await hash(JSON.stringify([s.memberVersion, s.members])))
      )
        fail("STALE_PLAN");
      if (new Set(input.rows).size !== input.rows.length)
        fail("INVALID_SELECTION", 400);
      for (const n of input.rows) {
        const r = plan.rows.find((r) => r.row === n);
        if (!r?.member || r.issue) fail("INVALID_SELECTION", 400);
        const index = s.members.findIndex((m) => m.id === r.member!.id);
        if (index < 0) s.members.push(r.member);
        else s.members[index] = r.member;
      }
      if (s.members.length > 100) fail("DEMO_LIMIT", 429);
      s.memberVersion = (s.memberVersion ?? 0) + 1;
      plan.applied = true;
      detail = { imported: input.rows.length };
    } else if (input.action === "status") {
      const m = s.members.find((m) => m.id === input.id);
      if (!m) fail("MEMBER_NOT_FOUND", 404);
      m.status = input.status;
      s.memberVersion = (s.memberVersion ?? 0) + 1;
    } else if (input.action === "charges") {
      for (const m of s.members.filter((m) => m.status === "active")) {
        const id = `${m.id}/${input.period}`;
        if (!s.charges.some((c) => c.id === id))
          s.charges.push({
            id,
            member: m.id,
            period: input.period,
            cents: m.category === "regular" ? 12000 : 6000,
          });
      }
      if (s.charges.length > 300) fail("DEMO_LIMIT", 429);
    } else if (input.action === "payments") {
      for (const [id, reference, centsText] of csvRows(
        input.csv,
        "id,reference,cents",
      )) {
        if (
          !/^BANK[0-9]{3,8}$/.test(id) ||
          !/^([A-Z0-9]{1,20})?$/.test(reference) ||
          !/^\d{1,7}$/.test(centsText) ||
          Number(centsText) <= 0
        )
          fail("INVALID_PAYMENT", 400);
        const p = { id, reference, cents: Number(centsText) };
        const prior = s.payments.find((v) => v.id === id);
        if (
          prior &&
          (prior.reference !== p.reference || prior.cents !== p.cents)
        )
          fail("PAYMENT_CONFLICT");
        if (!prior) s.payments.push(p);
      }
      if (s.payments.length > 300) fail("DEMO_LIMIT", 429);
    } else if (input.action === "reconcile") {
      // Only explicit reference + unique unpaid charge can be automatic.
      for (const p of s.payments.filter((p) => p.reference)) {
        const issue = discrepancies(s).find((d) => d.id === p.id);
        if (issue?.candidates.length === 1)
          s.allocations.push({ payment: p.id, charge: issue.candidates[0] });
      }
    } else if (input.action === "resolve") {
      const p = s.payments.find((p) => p.id === input.payment);
      const c = s.charges.find((c) => c.id === input.charge);
      if (!p || !c) fail("MATCH_NOT_FOUND", 404);
      if (
        p.cents !== c.cents ||
        s.allocations.some((a) => a.payment === p.id || a.charge === c.id)
      )
        fail("ALLOCATION_CONFLICT");
      s.allocations.push({ payment: p.id, charge: c.id });
    } else {
      const m = s.members.find((m) => m.id === input.member);
      if (!m) fail("MEMBER_NOT_FOUND", 404);
      const unpaid = s.charges.filter(
        (c) =>
          c.member === m.id && !s.allocations.some((a) => a.charge === c.id),
      );
      const total = unpaid.reduce((sum, c) => sum + c.cents, 0);
      const labels =
        input.language === "de"
          ? {
              notice: "Beitragsmitteilung",
              welcome: "Willkommen",
              reminder: "Zahlungserinnerung",
              demo: "DEMO — kein steuerlicher Beleg. Keine E-Mail versendet.",
              amount: "Offene Beiträge",
            }
          : {
              notice: "Zawiadomienie o składce",
              welcome: "Witamy",
              reminder: "Przypomnienie o płatności",
              demo: "DEMO — nie jest dokumentem księgowym. Nie wysłano e-maila.",
              amount: "Otwarte składki",
            };
      const text = `${labels[input.kind]}\n${m.name}\n${m.email}\n${labels.amount}: ${(total / 100).toFixed(2)} EUR\n${unpaid.map((c) => `${c.id}: ${(c.cents / 100).toFixed(2)} EUR`).join("\n")}\n${labels.demo}`;
      s.documents.push({
        id: crypto.randomUUID(),
        kind: input.kind,
        member: m.id,
        language: input.language,
        text,
      });
      if (s.documents.length > 50) fail("DEMO_LIMIT", 429);
    }
    const outcome = { revision, action: input.action, ...(detail as object) };
    await tx.$executeRaw`INSERT INTO association_revisions(organization_id,revision,actor_id,operation,command_key,fingerprint,state,outcome) VALUES(${actor.organizationId}::uuid,${revision},${actor.memberId}::uuid,${input.action},${key},${fingerprint},${JSON.stringify(s)}::jsonb,${JSON.stringify(outcome)}::jsonb)`;
    return outcome;
  });
}

export function accountingCsv(s: AssociationState) {
  return [
    "charge_id,member_id,period,currency,amount_cents,payment_id,status",
    ...s.charges.map((c) =>
      [
        c.id,
        c.member,
        c.period,
        "EUR",
        c.cents,
        s.allocations.find((a) => a.charge === c.id)?.payment ?? "",
        s.allocations.some((a) => a.charge === c.id) ? "paid" : "open",
      ].join(","),
    ),
  ].join("\r\n");
}
