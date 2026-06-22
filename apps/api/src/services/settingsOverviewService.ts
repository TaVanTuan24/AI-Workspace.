import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import { getPermissionsForRole, normalizeWorkspaceRole, type Permission, type WorkspaceRole } from "../auth/permissions.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import { getModelPreferences } from "./modelPreferenceService.js";
import { getProviderHealth } from "./providerHealthService.js";

export interface SettingsOverview {
  currentUser: {
    id: string;
    membershipId: string;
    role: WorkspaceRole;
    permissions: Permission[];
  };
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
  providerHealth: {
    openIncidents: number;
    criticalOpenIncidents: number;
    lastIncidentAt: string | null;
  };
  recovery?: {
    activeOverrides: number;
  };
}

export async function getSettingsOverview(
  userId: string,
  currentUser?: AuthenticatedUser,
  workspaceContext?: { role: WorkspaceRole; permissions: Permission[]; membershipId: string }
): Promise<SettingsOverview> {
  const now = Date.now();
  const from24h = new Date(now - 24 * 60 * 60 * 1000);
  const from7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [providerHealth, modelPreferences, apiKeyStatusCounts, usage24hStatusCounts, providerRateLimited24h, requests7d, openIncidents, activeOverrides] =
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
      }),
      prisma.providerHealthIncident.findMany({
        where: { userId, resolvedAt: null },
        select: { severity: true, startedAt: true },
        orderBy: { startedAt: "desc" }
      }),
      prisma.providerRecoveryOverride.count({
        where: {
          userId,
          status: "active",
          expiresAt: { gt: new Date(now) }
        }
      })
    ]);

  const failed24h = usage24hStatusCounts
    .filter((item) => item.status === "failed" || item.status === "timeout" || item.status === "client_disconnected")
    .reduce((sum, item) => sum + item._count.id, 0);

  let role = workspaceContext?.role;
  if (!role) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    role = normalizeWorkspaceRole(user?.role, "owner");
  }

  return {
    currentUser: {
      id: userId,
      membershipId: workspaceContext?.membershipId || "unknown",
      role,
      permissions: workspaceContext?.permissions || getPermissionsForRole(role)
    },
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
    },
    providerHealth: {
      openIncidents: openIncidents.length,
      criticalOpenIncidents: openIncidents.filter((inc) => inc.severity === "critical").length,
      lastIncidentAt: openIncidents.length > 0 ? openIncidents[0].startedAt.toISOString() : null
    },
    recovery: {
      activeOverrides
    }
  };
}
