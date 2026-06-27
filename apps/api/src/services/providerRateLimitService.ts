import { PROVIDERS, type ProviderId, isProviderId } from "@uaiw/shared/types/provider.js";
import { env } from "../config/env.js";
import { prisma } from "./prisma.js";
import { chatQueueConnection } from "./chatQueue.js";

export type ProviderRateLimitSource = "custom" | "env";

export interface ProviderRateLimitView {
  provider: ProviderId;
  requestsPerMinute: number | null;
  effectiveRequestsPerMinute: number;
  source: ProviderRateLimitSource;
  enabled: boolean;
}

export interface ProviderRateLimitCheckResult {
  allowed: boolean;
  provider: ProviderId;
  limit: number;
  current: number;
  remaining: number;
  resetAt: string;
  source: ProviderRateLimitSource;
}

export class ProviderRateLimitExceededError extends Error {
  readonly check: ProviderRateLimitCheckResult;

  constructor(check: ProviderRateLimitCheckResult) {
    super("Provider rate limit exceeded.");
    this.name = "ProviderRateLimitExceededError";
    this.check = check;
  }
}

export function getProviderEnvDefault(provider: ProviderId): number {
  if (provider === "chatgpt") return env.PROVIDER_RATE_LIMIT_CHATGPT_PER_MINUTE;
  if (provider === "gemini") return env.PROVIDER_RATE_LIMIT_GEMINI_PER_MINUTE;
  if (provider === "claude") return env.PROVIDER_RATE_LIMIT_CLAUDE_PER_MINUTE;
  return env.PROVIDER_RATE_LIMIT_DEFAULT_PER_MINUTE;
}

export async function listProviderRateLimitSettings(userId: string): Promise<{
  limits: ProviderRateLimitView[];
  maxRequestsPerMinute: number;
}> {
  const settings = await prisma.providerRateLimitSetting.findMany({
    where: { userId }
  });
  const byProvider = new Map(settings.map((setting) => [setting.provider, setting]));

  return {
    maxRequestsPerMinute: env.PROVIDER_RATE_LIMIT_MAX_PER_MINUTE,
    limits: PROVIDERS.map((provider) => {
      const setting = byProvider.get(provider);
      const custom = setting?.requestsPerMinute ?? null;
      const effective = custom ?? getProviderEnvDefault(provider);
      return {
        provider,
        requestsPerMinute: custom,
        effectiveRequestsPerMinute: effective,
        source: custom === null ? "env" : "custom",
        enabled: setting?.enabled ?? true
      };
    })
  };
}

export async function resolveProviderRateLimit(userId: string, provider: ProviderId): Promise<ProviderRateLimitView> {
  const setting = await prisma.providerRateLimitSetting.findUnique({
    where: {
      userId_provider: {
        userId,
        provider
      }
    }
  });
  const custom = setting?.requestsPerMinute ?? null;
  return {
    provider,
    requestsPerMinute: custom,
    effectiveRequestsPerMinute: custom ?? getProviderEnvDefault(provider),
    source: custom === null ? "env" : "custom",
    enabled: setting?.enabled ?? true
  };
}

export async function updateProviderRateLimitSetting(
  userId: string,
  provider: string,
  requestsPerMinute: number | null
): Promise<ProviderRateLimitView> {
  if (!isProviderId(provider)) {
    throw new Error("Invalid provider.");
  }
  if (requestsPerMinute !== null) {
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute <= 0) {
      throw new Error("requestsPerMinute must be a positive integer or null.");
    }
    if (requestsPerMinute > env.PROVIDER_RATE_LIMIT_MAX_PER_MINUTE) {
      throw new Error(`requestsPerMinute must be less than or equal to ${env.PROVIDER_RATE_LIMIT_MAX_PER_MINUTE}.`);
    }
  }

  await prisma.providerRateLimitSetting.upsert({
    where: {
      userId_provider: {
        userId,
        provider
      }
    },
    create: {
      userId,
      provider,
      requestsPerMinute,
      enabled: true
    },
    update: {
      requestsPerMinute,
      enabled: true
    }
  });

  return resolveProviderRateLimit(userId, provider);
}

export async function checkProviderRateLimit(userId: string, provider: ProviderId): Promise<ProviderRateLimitCheckResult> {
  const resolved = await resolveProviderRateLimit(userId, provider);
  const limit = resolved.effectiveRequestsPerMinute;
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const key = `provider-rate:${userId}:${provider}:${minuteBucket}`;
  const current = await chatQueueConnection.incr(key);
  if (current === 1) {
    await chatQueueConnection.expire(key, 65);
  }

  const resetAt = new Date((minuteBucket + 1) * 60_000).toISOString();
  const check = {
    allowed: current <= limit,
    provider,
    limit,
    current,
    remaining: Math.max(limit - current, 0),
    resetAt,
    source: resolved.source
  };

  if (!check.allowed) {
    throw new ProviderRateLimitExceededError(check);
  }

  return check;
}

export function providerRateLimitHeaders(check: ProviderRateLimitCheckResult): Record<string, string> {
  return {
    "X-Provider-RateLimit-Limit": String(check.limit),
    "X-Provider-RateLimit-Remaining": String(check.remaining),
    "X-Provider-RateLimit-Reset": check.resetAt
  };
}
