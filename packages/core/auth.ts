import type { Database } from "./db.js";
import type { RoleName } from "../contracts/index.js";
import { AppError, denied } from "./errors.js";

export async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function token() {
  return (
    crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "")
  );
}
export interface Identity {
  workspaceId: string;
  organizationId: string;
  memberId: string;
  name: string;
  role: RoleName;
  tokenHash: string;
  csrfToken: string;
}

export async function authenticate(
  db: Database,
  sessionToken: string | undefined,
): Promise<Identity> {
  if (!sessionToken || !/^[a-f0-9]{64}$/.test(sessionToken))
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Start your private demo to continue.",
    );
  const session = await db.session.findUnique({
    where: { tokenHash: await hash(sessionToken) },
    include: { workspace: true },
  });
  if (
    !session ||
    session.expiresAt <= new Date() ||
    session.workspace.expiresAt <= new Date()
  )
    throw new AppError(
      401,
      "SESSION_EXPIRED",
      "Your demo session expired. Start a new demo.",
    );
  const member = await db.member.findFirst({
    where: {
      id: session.memberId,
      organization: { workspaceId: session.workspaceId },
    },
  });
  if (!member || !["EMPLOYEE", "MANAGER", "OBSERVER"].includes(member.role))
    denied();
  return {
    workspaceId: session.workspaceId,
    organizationId: member.organizationId,
    memberId: member.id,
    name: member.name,
    role: member.role as RoleName,
    tokenHash: session.tokenHash,
    csrfToken: session.csrfToken,
  };
}

export async function startDemo(db: Database, dailyLimit?: number) {
  const sessionToken = token();
  const tokenHash = await hash(sessionToken);
  const csrfToken = token();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.$transaction(async (tx) => {
    if (dailyLimit !== undefined) {
      // Serialize quota admission across all Cloudflare locations.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(26100701)`;
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (
        (await tx.workspace.count({ where: { createdAt: { gte: today } } })) >=
        dailyLimit
      )
        throw new AppError(
          429,
          "DEMO_CAPACITY",
          "Today’s demo capacity is full. Please try tomorrow; the proof page remains available.",
        );
    }
    const workspace = await tx.workspace.create({
      data: { expiresAt: new Date(Date.now() + 7 * 86400000) },
    });
    let defaultMember = "";
    for (const name of ["Northwind Studio", "Contoso Labs"]) {
      const org = await tx.organization.create({
        data: { workspaceId: workspace.id, name },
      });
      const employee = await tx.member.create({
        data: { organizationId: org.id, name: "Alex Morgan", role: "EMPLOYEE" },
      });
      await tx.member.createMany({
        data: [
          { organizationId: org.id, name: "Sam Taylor", role: "MANAGER" },
          { organizationId: org.id, name: "Jordan Lee", role: "OBSERVER" },
        ],
      });
      defaultMember ||= employee.id;
      for (const [title, category, amountCents, status] of [
        ["Design workstation", "EQUIPMENT", 189900, "DRAFT"],
        ["Team research tools", "SOFTWARE", 24900, "SUBMITTED"],
      ]) {
        await tx.request.create({
          data: {
            organizationId: org.id,
            ownerId: employee.id,
            title: String(title),
            category: String(category),
            amountCents: Number(amountCents),
            status: String(status),
            description:
              "Synthetic demo request. Explore the workflow using your private workspace.",
          },
        });
      }
    }
    await tx.session.create({
      data: {
        tokenHash,
        workspaceId: workspace.id,
        memberId: defaultMember,
        csrfToken,
        expiresAt,
      },
    });
  });
  return { sessionToken, csrfToken };
}

export async function sessionView(
  db: Database,
  identity: Identity,
  backgroundMode: string,
) {
  const organizations = await db.organization.findMany({
    where: { workspaceId: identity.workspaceId },
    include: { members: { orderBy: { role: "asc" } } },
    orderBy: { name: "desc" },
  });
  return {
    identity: {
      organizationId: identity.organizationId,
      memberId: identity.memberId,
      name: identity.name,
      role: identity.role,
    },
    csrfToken: identity.csrfToken,
    organizations,
    backgroundMode,
  };
}

export async function switchIdentity(
  db: Database,
  identity: Identity,
  memberId: string,
) {
  const member = await db.member.findFirst({
    where: {
      id: memberId,
      organization: { workspaceId: identity.workspaceId },
    },
  });
  if (!member) denied();
  // A demo capability may only switch among seeded members of this visitor's workspace.
  const csrfToken = token();
  await db.session.update({
    where: { tokenHash: identity.tokenHash },
    data: { memberId, csrfToken },
  });
}
