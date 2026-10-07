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
  const tokenHash = await hash(sessionToken);
  const actors = await db.$queryRaw<Array<Identity>>`
    SELECT s.workspace_id AS "workspaceId", m.organization_id AS "organizationId",
           m.id AS "memberId", m.name, m.role, s.token_hash AS "tokenHash", s.csrf_token AS "csrfToken"
    FROM sessions s
    JOIN workspaces w ON w.id=s.workspace_id
    JOIN members m ON m.id=s.member_id
    JOIN organizations o ON o.id=m.organization_id AND o.workspace_id=s.workspace_id
    WHERE s.token_hash=${tokenHash} AND s.expires_at>now() AND w.expires_at>now()`;
  const actor = actors[0];
  if (!actor)
    throw new AppError(
      401,
      "SESSION_EXPIRED",
      "Your demo session expired. Start a new demo.",
    );
  if (!["EMPLOYEE", "MANAGER", "OBSERVER"].includes(actor.role)) denied();
  return actor;
}

export async function startDemo(db: Database, dailyLimit?: number) {
  const sessionToken = token();
  const tokenHash = await hash(sessionToken);
  const csrfToken = token();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const workspaceId = crypto.randomUUID();
  const workspaceExpiry = new Date(Date.now() + 7 * 86400000);
  const organizations = ["Northwind Studio", "Contoso Labs"].map((name) => ({
    id: crypto.randomUUID(),
    name,
  }));
  const members = organizations.flatMap((org) => [
    {
      id: crypto.randomUUID(),
      organization_id: org.id,
      name: "Alex Morgan",
      role: "EMPLOYEE",
    },
    {
      id: crypto.randomUUID(),
      organization_id: org.id,
      name: "Sam Taylor",
      role: "MANAGER",
    },
    {
      id: crypto.randomUUID(),
      organization_id: org.id,
      name: "Jordan Lee",
      role: "OBSERVER",
    },
  ]);
  const requests = organizations.flatMap((org) =>
    [
      {
        title: "Design workstation",
        category: "EQUIPMENT",
        amount_cents: 189900,
        status: "DRAFT",
      },
      {
        title: "Team research tools",
        category: "SOFTWARE",
        amount_cents: 24900,
        status: "SUBMITTED",
      },
    ].map((row) => ({
      ...row,
      id: crypto.randomUUID(),
      organization_id: org.id,
      owner_id: members.find(
        (m) => m.organization_id === org.id && m.role === "EMPLOYEE",
      )!.id,
    })),
  );
  const payload = JSON.stringify({
    workspaceId,
    workspaceExpiry,
    organizations,
    members,
    requests,
    tokenHash,
    memberId: members[0].id,
    csrfToken,
    expiresAt,
  });
  const [admission] = await db.$queryRaw<Array<{ accepted: boolean }>>`
    SELECT public.provision_demo_workspace(${payload}::jsonb,${dailyLimit ?? null}::int) AS accepted`;
  if (!admission.accepted)
    throw new AppError(
      429,
      "DEMO_CAPACITY",
      "Today’s demo capacity is full. Please try tomorrow; the proof page remains available.",
    );
  // These identities were committed by the single provisioning statement.
  // Return the committed fixture view without immediately re-reading it twice.
  const identity: Identity = {
    workspaceId,
    organizationId: organizations[0].id,
    memberId: members[0].id,
    name: members[0].name,
    role: "EMPLOYEE",
    tokenHash,
    csrfToken,
  };
  return {
    sessionToken,
    csrfToken,
    identity,
    organizations: organizations.map((org) => ({
      ...org,
      workspaceId,
      members: members
        .filter((m) => m.organization_id === org.id)
        .map(({ organization_id, ...m }) => ({
          ...m,
          organizationId: organization_id,
        })),
    })),
  };
}

export async function sessionView(
  db: Database,
  identity: Identity,
  backgroundMode: string,
) {
  const organizations = await db.$queryRaw<
    Array<{
      id: string;
      workspaceId: string;
      name: string;
      members: Array<{
        id: string;
        organizationId: string;
        name: string;
        role: string;
      }>;
    }>
  >`
    SELECT o.id,o.workspace_id AS "workspaceId",o.name,
      jsonb_agg(jsonb_build_object('id',m.id,'organizationId',m.organization_id,'name',m.name,'role',m.role) ORDER BY m.role) AS members
    FROM organizations o JOIN members m ON m.organization_id=o.id
    WHERE o.workspace_id=${identity.workspaceId}::uuid GROUP BY o.id ORDER BY o.name DESC`;

  return sessionDto(identity, organizations, backgroundMode);
}

export function sessionDto(
  identity: Identity,
  organizations: Array<{
    id: string;
    workspaceId: string;
    name: string;
    members: Array<{
      id: string;
      organizationId: string;
      name: string;
      role: string;
    }>;
  }>,
  backgroundMode: string,
) {
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
