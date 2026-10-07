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
    // One statement provisions the graph. CTE dependencies use inserted rows,
    // so foreign keys and the transaction still arbitrate the whole bootstrap.
    await tx.$executeRaw`
      WITH w AS (
        INSERT INTO workspaces (id,expires_at) VALUES (${workspaceId}::uuid,${workspaceExpiry}) RETURNING id
      ), o AS (
        INSERT INTO organizations (id,workspace_id,name)
        SELECT x.id,w.id,x.name FROM w, jsonb_to_recordset(${JSON.stringify(organizations)}::jsonb) AS x(id uuid,name text) RETURNING id
      ), m AS (
        INSERT INTO members (id,organization_id,name,role)
        SELECT x.id,o.id,x.name,x.role FROM o JOIN jsonb_to_recordset(${JSON.stringify(members)}::jsonb)
          AS x(id uuid,organization_id uuid,name text,role text) ON x.organization_id=o.id RETURNING id,organization_id
      ), r AS (
        INSERT INTO requests (id,organization_id,owner_id,title,description,category,amount_cents,status)
        SELECT x.id,m.organization_id,m.id,x.title,'Synthetic demo request. Explore the workflow using your private workspace.',x.category,x.amount_cents,x.status
        FROM m JOIN jsonb_to_recordset(${JSON.stringify(requests)}::jsonb)
          AS x(id uuid,organization_id uuid,owner_id uuid,title text,category text,amount_cents int,status text) ON x.owner_id=m.id RETURNING id
      )
      INSERT INTO sessions (token_hash,workspace_id,member_id,csrf_token,expires_at)
      SELECT ${tokenHash},w.id,m.id,${csrfToken},${expiresAt} FROM w,m WHERE m.id=${members[0].id}::uuid`;
  });
  return { sessionToken, csrfToken };
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
