import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import { getWorkspaceUsageSummary } from "./workspaceQuotaService.js";
import { listSchedulerStatuses, type SchedulerStatusView } from "./schedulerStatusService.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceAdminOverviewDTO {
  workspace: { id: string; name: string; slug?: string };
  members: { active: number; disabled: number; pendingInvites: number };
  quotas: { exceeded: number; nearLimit: number };
  schedulers: Array<{ name: string; enabled: boolean; lastStatus?: string; lastFinishedAt?: string }>;
  notifications: { unread: number; criticalRecent: number };
  providers: { usable: number; requiresAttention: number };
  emailDelivery: { enabled: boolean; provider: string; dryRun: boolean; realSendPossible: boolean };
  webhooks: { destinations: number; deadLetters: number };
  diagnostics: { openDriftAlerts: number };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function getWorkspaceAdminOverview(params: {
  workspaceId: string;
}): Promise<WorkspaceAdminOverviewDTO> {
  const { workspaceId } = params;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, slug: true },
  });

  if (!workspace) throw new Error("Workspace not found");

  // Parallel queries for safe aggregate counts
  const [
    activeMembers, disabledMembers, pendingInvites,
    schedulerStatuses, memberUserIds,
  ] = await Promise.all([
    prisma.workspaceMembership.count({ where: { workspaceId, status: "active" } }),
    prisma.workspaceMembership.count({ where: { workspaceId, status: "disabled" } }),
    prisma.workspaceInvite.count({ where: { workspaceId, status: "pending" } }),
    listSchedulerStatuses(),
    prisma.workspaceMembership.findMany({
      where: { workspaceId, status: "active" },
      select: { userId: true },
    }),
  ]);

  const userIds = memberUserIds.map((m) => m.userId);

  // Second wave of parallel queries
  const [
    unreadNotifications, criticalNotifications,
    webhookDestinations, deadLetters, openDriftAlerts,
    quotaSummary,
  ] = await Promise.all([
    userIds.length > 0
      ? prisma.notificationEvent.count({
          where: { userId: { in: userIds }, readAt: null },
        })
      : Promise.resolve(0),
    userIds.length > 0
      ? prisma.notificationEvent.count({
          where: {
            userId: { in: userIds },
            severity: "critical",
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        })
      : Promise.resolve(0),
    userIds.length > 0
      ? prisma.notificationWebhookDestination.count({
          where: { userId: { in: userIds } },
        })
      : Promise.resolve(0),
    userIds.length > 0
      ? prisma.notificationDeadLetter.count({
          where: { userId: { in: userIds }, status: "open" },
        })
      : Promise.resolve(0),
    userIds.length > 0
      ? prisma.providerDiagnosticsDriftAlert.count({
          where: { userId: { in: userIds }, resolvedAt: null },
        })
      : Promise.resolve(0),
    getWorkspaceUsageSummary({ workspaceId }).catch(() => null),
  ]);

  // Provider health: count usable vs requires attention from workspace members
  let usableProviders = 0;
  let requiresAttention = 0;
  if (userIds.length > 0) {
    const connections = await prisma.providerConnection.findMany({
      where: { workspaceId },
      select: { status: true },
    });
    for (const c of connections) {
      if (c.status === "connected") usableProviders++;
      else requiresAttention++;
    }
  }

  // Quotas analysis
  let exceeded = 0;
  let nearLimit = 0;
  if (quotaSummary) {
    for (const q of quotaSummary.quotas) {
      if (q.exceeded) exceeded++;
      else if (q.limit !== null && q.remaining !== null && q.remaining <= Math.ceil(q.limit * 0.1)) {
        nearLimit++;
      }
    }
  }

  return {
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    members: { active: activeMembers, disabled: disabledMembers, pendingInvites },
    quotas: { exceeded, nearLimit },
    schedulers: schedulerStatuses.map((s: SchedulerStatusView) => ({
      name: s.name,
      enabled: s.enabled,
      lastStatus: s.lastStatus,
      lastFinishedAt: s.lastFinishedAt,
    })),
    notifications: { unread: unreadNotifications, criticalRecent: criticalNotifications },
    providers: { usable: usableProviders, requiresAttention },
    emailDelivery: {
      enabled: env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED,
      provider: env.WORKSPACE_INVITE_EMAIL_PROVIDER,
      dryRun: env.WORKSPACE_INVITE_EMAIL_DRY_RUN,
      realSendPossible: env.WORKSPACE_INVITE_EMAIL_ALLOW_REAL_SEND && env.WORKSPACE_INVITE_EMAIL_PROVIDER === "smtp",
    },
    webhooks: { destinations: webhookDestinations, deadLetters },
    diagnostics: { openDriftAlerts },
  };
}
