import { PrismaClient } from "#prisma-client";
import { PrismaPg } from "@prisma/adapter-pg";

export function connectDatabase(connectionString: string, max = 5) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
}
// Shared core uses only database operations, never runtime-specific Prisma APIs.
// This structural boundary accepts the Node and workerd generated clients.
export type DatabaseSession = Pick<
  PrismaClient,
  | "workspace"
  | "organization"
  | "member"
  | "session"
  | "request"
  | "auditEvent"
  | "command"
  | "outboxEvent"
  | "report"
  | "jobAttempt"
  | "$queryRaw"
  | "$executeRaw"
>;
export type Database = DatabaseSession & {
  $transaction<T>(
    run: (tx: DatabaseSession) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
};
export type { Prisma } from "#prisma-client";
