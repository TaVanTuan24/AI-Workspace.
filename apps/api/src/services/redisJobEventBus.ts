import { Redis } from "ioredis";
import type { ProviderEvent } from "@uaiw/shared/types/provider.js";
import { env } from "../config/env.js";

const EVENT_TTL_SECONDS = 60 * 10;
const MAX_REPLAY_EVENTS = 100;

export function jobChannel(jobId: string): string {
  return `job:${jobId}`;
}

function replayKey(jobId: string): string {
  return `job:${jobId}:events`;
}

export class RedisJobEventSubscriber {
  async subscribe(
    jobId: string,
    onEvent: (event: ProviderEvent) => void
  ): Promise<() => Promise<void>> {
    const replayClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

    const replay = await replayClient.lrange(replayKey(jobId), 0, -1);
    for (const serialized of replay) {
      const event = safeParseEvent(serialized);
      if (event) onEvent(event);
    }

    subscriber.on("message", (_channel: string, message: string) => {
      const event = safeParseEvent(message);
      if (event) onEvent(event);
    });

    await subscriber.subscribe(jobChannel(jobId));
    await replayClient.quit();

    return async () => {
      await subscriber.unsubscribe(jobChannel(jobId)).catch(() => {});
      subscriber.disconnect();
    };
  }
}

export function safeParseEvent(serialized: string): ProviderEvent | null {
  try {
    const parsed = JSON.parse(serialized) as ProviderEvent;
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export { EVENT_TTL_SECONDS, MAX_REPLAY_EVENTS, replayKey };
