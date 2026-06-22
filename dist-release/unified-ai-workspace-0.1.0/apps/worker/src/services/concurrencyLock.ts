import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

export class RedisConcurrencyLock {
  constructor(private readonly redis: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, "PX", ttlMs, "NX");
    return result === "OK" ? token : null;
  }

  async release(key: string, token: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
      return 0
    `;
    const result = await this.redis.eval(script, 1, key, token);
    return result === 1;
  }
}

export function chatLockKey(userId: string, provider: string): string {
  return `lock:chat:${userId}:${provider}`;
}
