import { Queue } from "bullmq";

export const queueName = process.env.QUEUE_NAME ?? "operations-reports";
export function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
export interface ReportJob {
  eventId: string;
  generation: number;
}
export function reportQueue() {
  return new Queue<ReportJob>(queueName, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 1000 },
    },
  });
}
export function reportJobId(eventId: string, generation: number) {
  return `report-${eventId}-${generation}`;
}
