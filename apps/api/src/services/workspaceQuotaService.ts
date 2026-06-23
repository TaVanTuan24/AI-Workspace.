import { prisma } from './prisma.js';
import { SafeError } from './safeProviderError.js';
import { maybeCreateQuotaWarningAlert, maybeCreateQuotaExceededAlert } from './workspaceQuotaAlertService.js';

export type WorkspaceQuotaResource =
  | 'members'
  | 'pendingInvites'
  | 'apiKeys'
  | 'providerConnections'
  | 'webhookDestinations'
  | 'recoveryPolicies'
  | 'diagnosticsBaselines'
  | 'monthlyApiRequests'
  | 'monthlyInviteEmails';

export type WorkspaceQuotaSource =
  | 'workspace_invite_create'
  | 'workspace_invite_accept'
  | 'workspace_member_enable'
  | 'api_key_create'
  | 'provider_connection_create'
  | 'webhook_destination_create'
  | 'recovery_policy_create'
  | 'diagnostics_baseline_create'
  | 'openai_compat_chat'
  | 'internal_chat'
  | 'internal_multi_chat'
  | 'conversation_import';

export interface WorkspaceQuotaStatus {
  resource: WorkspaceQuotaResource;
  limit: number | null;
  used: number;
  remaining: number | null;
  exceeded: boolean;
}

export interface WorkspaceUsageSummary {
  plan: string;
  quotas: WorkspaceQuotaStatus[];
}

export interface UpdateQuotaPatch {
  maxMembers?: number | null;
  maxInvites?: number | null;
  maxApiKeys?: number | null;
  maxProviderConnections?: number | null;
  maxWebhookDestinations?: number | null;
  maxRecoveryPolicies?: number | null;
  maxDiagnosticsBaselines?: number | null;
  maxMonthlyApiRequests?: number | null;
  maxMonthlyInviteEmails?: number | null;
}

/**
 * Returns the default quota for the local self-hosted plan.
 * You can adjust these or pull from env vars later if needed.
 */
function getDefaultQuotaLimits() {
  return {
    plan: 'local',
    maxMembers: null, // Unlimited in local by default
    maxInvites: null,
    maxApiKeys: null,
    maxProviderConnections: null,
    maxWebhookDestinations: null,
    maxRecoveryPolicies: null,
    maxDiagnosticsBaselines: null,
    maxMonthlyApiRequests: null,
    maxMonthlyInviteEmails: null,
  };
}

/**
 * Gets or lazily creates a workspace quota row.
 */
export async function getOrCreateWorkspaceQuota(workspaceId: string) {
  const existing = await prisma.workspaceQuota.findUnique({
    where: { workspaceId },
  });

  if (existing) {
    return existing;
  }

  return await prisma.workspaceQuota.create({
    data: {
      workspaceId,
      ...getDefaultQuotaLimits(),
    },
  });
}

/**
 * Returns the current usage and limits for all tracked resources in a workspace.
 */
export async function getWorkspaceUsageSummary(params: {
  workspaceId: string;
  now?: Date;
}): Promise<WorkspaceUsageSummary> {
  const { workspaceId } = params;
  const now = params.now || new Date();

  const quota = await getOrCreateWorkspaceQuota(workspaceId);

  // Month bounds for monthly quotas (UTC)
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const [
    membersCount,
    pendingInvitesCount,
    apiKeysCount,
    providerConnectionsCount,
    webhookDestinationsCount,
    recoveryPoliciesCount,
    diagnosticsBaselinesCount,
    monthlyApiRequestsCount,
    monthlyInviteEmailsCount,
  ] = await Promise.all([
    // members
    prisma.workspaceMembership.count({
      where: { workspaceId, status: 'active' },
    }),
    // pendingInvites
    prisma.workspaceInvite.count({
      where: { workspaceId, status: 'pending' },
    }),
    // apiKeys
    prisma.internalApiKey.count({
      where: { workspaceId, status: 'active' },
    }),
    // providerConnections
    prisma.providerConnection.count({
      where: { workspaceId },
    }),
    // webhookDestinations
    prisma.notificationWebhookDestination.count({
      where: {
        userId: {
          in: (
            await prisma.workspaceMembership.findMany({
              where: { workspaceId },
              select: { userId: true },
            })
          ).map((m: any) => m.userId),
        },
      },
    }),
    // recoveryPolicies
    prisma.providerRecoveryPolicy.count({
      where: { workspaceId },
    }),
    // diagnosticsBaselines
    prisma.providerDiagnosticsBaseline.count({
      where: { workspaceId, isActive: true },
    }),
    // monthlyApiRequests
    prisma.internalApiUsageLog.count({
      where: {
        workspaceId,
        createdAt: { gte: startOfMonth, lte: endOfMonth },
      },
    }),
    // monthlyInviteEmails
    prisma.workspaceInviteDeliveryAttempt.count({
      where: {
        workspaceId,
        createdAt: { gte: startOfMonth, lte: endOfMonth },
      },
    }),
  ]);

  const mapStatus = (
    resource: WorkspaceQuotaResource,
    used: number,
    limit: number | null
  ): WorkspaceQuotaStatus => {
    return {
      resource,
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
      exceeded: limit !== null && used >= limit,
    };
  };

  return {
    plan: quota.plan,
    quotas: [
      mapStatus('members', membersCount, quota.maxMembers),
      mapStatus('pendingInvites', pendingInvitesCount, quota.maxInvites),
      mapStatus('apiKeys', apiKeysCount, quota.maxApiKeys),
      mapStatus('providerConnections', providerConnectionsCount, quota.maxProviderConnections),
      mapStatus('webhookDestinations', webhookDestinationsCount, quota.maxWebhookDestinations),
      mapStatus('recoveryPolicies', recoveryPoliciesCount, quota.maxRecoveryPolicies),
      mapStatus('diagnosticsBaselines', diagnosticsBaselinesCount, quota.maxDiagnosticsBaselines),
      mapStatus('monthlyApiRequests', monthlyApiRequestsCount, quota.maxMonthlyApiRequests),
      mapStatus('monthlyInviteEmails', monthlyInviteEmailsCount, quota.maxMonthlyInviteEmails),
    ],
  };
}

/**
 * Checks if incrementing a given resource by `incrementBy` exceeds the quota limit.
 */
export async function checkWorkspaceQuota(params: {
  workspaceId: string;
  resource: WorkspaceQuotaResource;
  incrementBy?: number;
}): Promise<{ exceeded: boolean; limit: number | null; used: number }> {
  const { workspaceId, resource, incrementBy = 1 } = params;

  const summary = await getWorkspaceUsageSummary({ workspaceId });
  const status = summary.quotas.find((q) => q.resource === resource);

  if (!status) {
    throw new Error(`Unknown quota resource: ${resource}`);
  }

  const { limit, used } = status;
  if (limit === null) {
    return { exceeded: false, limit, used };
  }

  return { exceeded: used + incrementBy > limit, limit, used };
}

/**
 * Records a quota exceeded event safely for audit and UX purposes.
 */
export async function recordQuotaExceeded(params: {
  workspaceId: string;
  actorUserId?: string;
  resource: WorkspaceQuotaResource;
  limit: number | null;
  used: number;
  attemptedIncrement?: number;
  source: WorkspaceQuotaSource;
}) {
  await prisma.workspaceQuotaEvent.create({
    data: {
      workspaceId: params.workspaceId,
      actorUserId: params.actorUserId,
      resource: params.resource,
      limit: params.limit,
      used: params.used,
      attemptedIncrement: params.attemptedIncrement ?? 1,
      source: params.source,
    },
  });

  if (params.limit !== null) {
    // Non-blocking, best effort exceeded alert
    maybeCreateQuotaExceededAlert({
      workspaceId: params.workspaceId,
      actorUserId: params.actorUserId,
      resource: params.resource,
      limit: params.limit,
      used: params.used,
      attemptedIncrement: params.attemptedIncrement ?? 1,
      source: params.source,
    }).catch(err => {
      console.error("[WorkspaceQuota] failed to dispatch exceeded alert", err);
    });
  }
}

/**
 * Asserts that the quota for a resource is not exceeded. Throws a SafeError if exceeded.
 */
export async function assertWorkspaceQuota(params: {
  workspaceId: string;
  resource: WorkspaceQuotaResource;
  incrementBy?: number;
  actorUserId?: string;
  source?: WorkspaceQuotaSource;
  notify?: boolean;
}): Promise<void> {
  const { exceeded, limit, used } = await checkWorkspaceQuota(params);
  if (exceeded) {
    if (params.source) {
      // Record safely in background/awaited
      await recordQuotaExceeded({
        workspaceId: params.workspaceId,
        actorUserId: params.actorUserId,
        resource: params.resource,
        limit,
        used,
        attemptedIncrement: params.incrementBy,
        source: params.source,
      });
    }

    throw new SafeError('workspace_quota_exceeded', 'Workspace quota exceeded for resource.', 403, {
      resource: params.resource,
      limit,
      used,
      remaining: limit !== null ? Math.max(0, limit - used) : null
    });
  }

  if (params.notify !== false && limit !== null) {
    // Check if we are near limit and should warn
    const futureUsed = used + (params.incrementBy ?? 1);
    maybeCreateQuotaWarningAlert({
      workspaceId: params.workspaceId,
      actorUserId: params.actorUserId,
      resource: params.resource,
      limit,
      used: futureUsed,
      source: params.source || "unknown",
    }).catch(err => {
      console.error("[WorkspaceQuota] failed to dispatch warning alert", err);
    });
  }
}

/**
 * Updates the workspace quota limits. Typically restricted to owners.
 */
export async function updateWorkspaceQuota(params: {
  workspaceId: string;
  patch: UpdateQuotaPatch;
}) {
  const { workspaceId, patch } = params;

  // Lazily create if it doesn't exist
  await getOrCreateWorkspaceQuota(workspaceId);

  return await prisma.workspaceQuota.update({
    where: { workspaceId },
    data: {
      maxMembers: patch.maxMembers,
      maxInvites: patch.maxInvites,
      maxApiKeys: patch.maxApiKeys,
      maxProviderConnections: patch.maxProviderConnections,
      maxWebhookDestinations: patch.maxWebhookDestinations,
      maxRecoveryPolicies: patch.maxRecoveryPolicies,
      maxDiagnosticsBaselines: patch.maxDiagnosticsBaselines,
      maxMonthlyApiRequests: patch.maxMonthlyApiRequests,
      maxMonthlyInviteEmails: patch.maxMonthlyInviteEmails,
    },
  });
}

/**
 * Returns recent quota exceeded events for a workspace.
 */
export async function getWorkspaceQuotaEvents(params: {
  workspaceId: string;
  resource?: string;
  limit?: number;
}) {
  return await prisma.workspaceQuotaEvent.findMany({
    where: {
      workspaceId: params.workspaceId,
      ...(params.resource ? { resource: params.resource } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: params.limit || 50,
    select: {
      id: true,
      resource: true,
      source: true,
      limit: true,
      used: true,
      attemptedIncrement: true,
      createdAt: true
    }
  });
}
