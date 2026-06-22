import { Redis } from "ioredis";
import type { ProviderEvent, ProviderId } from "@uaiw/shared/types/provider.js";
import { env } from "../config/env.js";

const EVENT_TTL_SECONDS = 60 * 10;
const MAX_REPLAY_EVENTS = 100;

function jobChannel(jobId: string): string {
  return `job:${jobId}`;
}

function replayKey(jobId: string): string {
  return `job:${jobId}:events`;
}

export const eventRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});

export async function publishJobEvent(jobId: string, event: ProviderEvent): Promise<void> {
  const serialized = JSON.stringify(event);
  const key = replayKey(jobId);
  await eventRedis
    .multi()
    .rpush(key, serialized)
    .ltrim(key, -MAX_REPLAY_EVENTS, -1)
    .expire(key, EVENT_TTL_SECONDS)
    .publish(jobChannel(jobId), serialized)
    .exec();
}

export async function publishDone(jobId: string, provider: ProviderId): Promise<void> {
  await publishJobEvent(jobId, { type: "done", jobId, provider });
}

export async function closeJobEventPublisher(): Promise<void> {
  await eventRedis.quit().catch(() => {
    eventRedis.disconnect();
  });
}
