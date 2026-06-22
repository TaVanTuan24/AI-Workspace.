import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import { getModelPreferences } from "./modelPreferenceService.js";
import { getProviderHealth } from "./providerHealthService.js";

export interface SettingsOverview {
  providers: {
    total: number;
    connected: number;
    usable: number;
    requiresLogin: number;
  };
  models: {
    total: number;
    enabled: number;
    usable: number;
    defaultModelId: string | null;
  };
  apiKeys: {
    active: number;
    revoked: number;
  };
  usage: {
    requests24h: number;
    failed24h: number;
    rateLimited24h: number;
    providerRateLimited24h: number;
    requests7d: number;
  };
  backups: {
    lastExportAt: string | null;
    tracked: boolean;
  };
  scheduler: {
    providerHealthEnabled: boolean;
  };
}

export async function getSettingsOverview(userId: string): Promise<SettingsOverview> {
  const now = Date.now();
  const from24h = new Date(now - 24 * 60 * 60 * 1000);
  const from7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [providerHealth, modelPreferences, apiKeyStatusCounts, usage24hStatusCounts, providerRateLimited24h, requests7d] =
    await Promise.all([
      getProviderHealth(userId),
      getModelPreferences(userId),
      prisma.internalApiKey.groupBy({
        by: ["status"],
        where: { userId },
        _count: { id: true }
      }),
      prisma.internalApiUsageLog.groupBy({
        by: ["status"],
        where: {
          userId,
          createdAt: { gte: from24h }
        },
        _count: { id: true }
      }),
      prisma.internalApiUsageLog.count({
        where: {
          userId,
          status: "rate_limited",
          errorCode: "provider_rate_limit_exceeded",
          createdAt: { gte: from24h }
        }
      }),
      prisma.internalApiUsageLog.count({
        where: {
          userId,
          createdAt: { gte: from7d }
        }
      })
    ]);

  const failed24h = usage24hStatusCounts
    .filter((item) => item.status === "failed" || item.status === "timeout" || item.status === "client_disconnected")
    .reduce((sum, item) => sum + item._count.id, 0);

  return {
    providers: {
      total: providerHealth.length,
      connected: providerHealth.filter((item) => item.connectionStatus === "connected").length,
      usable: providerHealth.filter((item) => item.isUsable).length,
      requiresLogin: providerHealth.filter((item) =>
        ["requires_login", "manual_action_required", "expired"].includes(item.connectionStatus)
      ).length
    },
    models: {
      total: modelPreferences.models.length,
      enabled: modelPreferences.models.filter((item) => item.enabled).length,
      usable: modelPreferences.models.filter((item) => item.enabled && item.isUsable).length,
      defaultModelId: modelPreferences.models.find((item) => item.isDefault)?.modelId ?? null
    },
    apiKeys: {
      active: apiKeyStatusCounts.find((item) => item.status === "active")?._count.id ?? 0,
      revoked: apiKeyStatusCounts.find((item) => item.status === "revoked")?._count.id ?? 0
    },
    usage: {
      requests24h: usage24hStatusCounts.reduce((sum, item) => sum + item._count.id, 0),
      failed24h,
      rateLimited24h: usage24hStatusCounts.find((item) => item.status === "rate_limited")?._count.id ?? 0,
      providerRateLimited24h,
      requests7d
    },
    backups: {
      lastExportAt: null,
      tracked: false
    },
    scheduler: {
      providerHealthEnabled: env.PROVIDER_HEALTH_SCHEDULER_ENABLED
    }
  };
}
