import { Redis } from "ioredis";
import type { ProviderEvent, ProviderId } from "@uaiw/shared/types/provider.js";
import { env } from "../config/env.js";

const EVENT_TTL_SECONDS = 60 * 10;
const MAX_REPLAY_EVENTS = 100;

export function jobChannel(jobId: string): string {
  return `job:${jobId}`;
}

function replayKey(jobId: string): string {
  return `job:${jobId}:events`;
}

export class RedisJobEventPublisher {
  constructor(private readonly redis: Redis) {}

  async publish(jobId: string, event: ProviderEvent): Promise<void> {
    const serialized = JSON.stringify(event);
    const key = replayKey(jobId);
    await this.redis
      .multi()
      .rpush(key, serialized)
      .ltrim(key, -MAX_REPLAY_EVENTS, -1)
      .expire(key, EVENT_TTL_SECONDS)
      .publish(jobChannel(jobId), serialized)
      .exec();
  }

  async complete(jobId: string, provider: ProviderId): Promise<void> {
    await this.publish(jobId, { type: "done", jobId, provider });
    await this.redis.expire(replayKey(jobId), EVENT_TTL_SECONDS);
  }
}
