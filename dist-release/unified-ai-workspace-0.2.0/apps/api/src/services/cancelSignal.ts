import { Redis } from "ioredis";
import { env } from "../config/env.js";

const CANCEL_TTL_SECONDS = 60 * 10;

export const cancelRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});

export function cancelKey(jobId: string): string {
  return `cancel:job:${jobId}`;
}

export async function requestJobCancel(jobId: string): Promise<void> {
  await cancelRedis.set(cancelKey(jobId), "1", "EX", CANCEL_TTL_SECONDS);
}

export async function isCancelRequested(jobId: string): Promise<boolean> {
  return (await cancelRedis.get(cancelKey(jobId))) === "1";
}

export async function closeCancelSignal(): Promise<void> {
  await cancelRedis.quit().catch(() => {
    cancelRedis.disconnect();
  });
}
