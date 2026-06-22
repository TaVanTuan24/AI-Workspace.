import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "./env.js";

const validSessionKey = Buffer.alloc(32, 1).toString("base64");

describe("api env validation", () => {
  it("requires production secrets", () => {
    expect(() =>
      parseEnv(
        {
          NODE_ENV: "production",
          REDIS_URL: "redis://localhost:6379",
          DATABASE_URL: "file:./prod.db"
        },
        { warn: vi.fn() }
      )
    ).toThrow(/SESSION_MASTER_KEY/);
  });

  it("accepts production DB API key mode with strong secrets", () => {
    const env = parseEnv(
      {
        NODE_ENV: "production",
        DATABASE_URL: "file:./prod.db",
        REDIS_URL: "redis://localhost:6379",
        SESSION_MASTER_KEY: validSessionKey,
        ENABLE_DB_API_KEYS: "true",
        API_KEY_HASH_SECRET: "a".repeat(32)
      },
      { warn: vi.fn() }
    );

    expect(env.ENABLE_DB_API_KEYS).toBe(true);
    expect(env.PROVIDER_HEALTH_SCHEDULER_LOCK_TTL_SECONDS).toBeLessThanOrEqual(
      env.PROVIDER_HEALTH_SCHEDULER_INTERVAL_SECONDS
    );
  });

  it("warns but allows local missing secrets", () => {
    const warn = vi.fn();
    const env = parseEnv({ NODE_ENV: "development" }, { warn });

    expect(env.NODE_ENV).toBe("development");
    expect(warn).toHaveBeenCalled();
  });
});
