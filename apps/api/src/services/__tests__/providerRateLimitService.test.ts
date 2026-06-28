import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env.js";
import { prisma } from "../prisma.js";
import { chatQueueConnection } from "../chatQueue.js";
import {
  checkProviderRateLimit,
  listProviderRateLimitSettings,
  ProviderRateLimitExceededError,
  updateProviderRateLimitSetting
} from "../providerRateLimitService.js";

vi.mock("../prisma.js", () => ({
  prisma: {
    providerRateLimitSetting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn()
    }
  }
}));

vi.mock("../chatQueue.js", () => ({
  chatQueueConnection: {
    incr: vi.fn(),
    expire: vi.fn()
  }
}));

describe("providerRateLimitService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.PROVIDER_RATE_LIMIT_MAX_PER_MINUTE = 300;
    env.PROVIDER_RATE_LIMIT_CHATGPT_PER_MINUTE = 20;
    env.PROVIDER_RATE_LIMIT_GEMINI_PER_MINUTE = 30;
    env.PROVIDER_RATE_LIMIT_CLAUDE_PER_MINUTE = 10;
  });

  it("returns env defaults and custom overrides without secrets", async () => {
    vi.mocked(prisma.providerRateLimitSetting.findMany).mockResolvedValueOnce([
      {
        id: "limit-1",
        userId: "user-1",
        provider: "claude",
        requestsPerMinute: 5,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    const result = await listProviderRateLimitSettings("user-1");

    expect(result.maxRequestsPerMinute).toBe(300);
    expect(result.limits).toContainEqual({
      provider: "chatgpt",
      requestsPerMinute: null,
      effectiveRequestsPerMinute: 20,
      source: "env",
      enabled: true
    });
    expect(result.limits).toContainEqual({
      provider: "claude",
      requestsPerMinute: 5,
      effectiveRequestsPerMinute: 5,
      source: "custom",
      enabled: true
    });
    expect(JSON.stringify(result)).not.toContain("cookie");
    expect(JSON.stringify(result)).not.toContain("token");
  });

  it("rejects custom limits above the configured maximum", async () => {
    await expect(updateProviderRateLimitSetting("user-1", "chatgpt", 301)).rejects.toThrow(
      "less than or equal to 300"
    );
    expect(prisma.providerRateLimitSetting.upsert).not.toHaveBeenCalled();
  });

  it("increments a provider-scoped Redis key and allows within limit", async () => {
    vi.mocked(prisma.providerRateLimitSetting.findUnique).mockResolvedValueOnce(null);
    vi.mocked(chatQueueConnection.incr).mockResolvedValueOnce(1);
    vi.mocked(chatQueueConnection.expire).mockResolvedValueOnce(1);

    const check = await checkProviderRateLimit("user-1", "chatgpt");

    expect(check.allowed).toBe(true);
    expect(check.limit).toBe(20);
    expect(chatQueueConnection.incr).toHaveBeenCalledWith(expect.stringMatching(/^provider-rate:user-1:chatgpt:\d+$/));
    expect(chatQueueConnection.expire).toHaveBeenCalledWith(expect.stringMatching(/^provider-rate:user-1:chatgpt:\d+$/), 65);
  });

  it("throws a typed error when the provider limit is exceeded", async () => {
    vi.mocked(prisma.providerRateLimitSetting.findUnique).mockResolvedValueOnce({
      id: "limit-1",
      userId: "user-1",
      provider: "claude",
      requestsPerMinute: 1,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    vi.mocked(chatQueueConnection.incr).mockResolvedValueOnce(2);

    await expect(checkProviderRateLimit("user-1", "claude")).rejects.toBeInstanceOf(
      ProviderRateLimitExceededError
    );
  });
});
