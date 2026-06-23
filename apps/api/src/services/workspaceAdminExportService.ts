import { prisma } from "./prisma.js";
import { getWorkspaceAdminOverview } from "./workspaceAdminOverviewService.js";
import { getSchedulerFleetStatus } from "./schedulerFleetStatusService.js";
import { getWorkspaceActivityTimeline, type ActivityRange } from "./workspaceActivityService.js";
import { getWorkspaceQuotaReport } from "./workspaceQuotaReportService.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceAdminExportDTO {
  exportedAt: string;
  range: string;
  workspace: { id: string; name: string; slug?: string };
  adminOverview: Awaited<ReturnType<typeof getWorkspaceAdminOverview>>;
  schedulerFleetStatus: Awaited<ReturnType<typeof getSchedulerFleetStatus>>;
  activityTimeline: { events: Array<Record<string, unknown>>; totalReturned: number };
  quotaReport?: Awaited<ReturnType<typeof getWorkspaceQuotaReport>> | null;
  inviteSummary: { total: number; pending: number; accepted: number; revoked: number; expired: number };
  recoveryOverrides: { active: number; expired: number };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function getWorkspaceAdminExport(params: {
  actorUserId: string;
  workspaceId: string;
  range: ActivityRange;
}): Promise<WorkspaceAdminExportDTO> {
  const { actorUserId, workspaceId, range } = params;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, slug: true },
  });

  if (!workspace) throw new Error("Workspace not found");

  // Parallel fetches
  const [adminOverview, schedulerFleetStatus, activityResult, quotaReport, inviteCounts, recoveryOverrides] =
    await Promise.all([
      getWorkspaceAdminOverview({ workspaceId }),
      getSchedulerFleetStatus(),
      getWorkspaceActivityTimeline({
        actorUserId,
        workspaceId,
        range,
        limit: 200, // cap export timeline events
      }),
      getWorkspaceQuotaReport({ actorUserId, workspaceId, range }).catch(() => null),
      getInviteSummary(workspaceId),
      getRecoveryOverrideSummary(workspaceId),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    range,
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    adminOverview,
    schedulerFleetStatus,
    activityTimeline: {
      events: activityResult.events as unknown as Array<Record<string, unknown>>,
      totalReturned: activityResult.events.length,
    },
    quotaReport,
    inviteSummary: inviteCounts,
    recoveryOverrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getInviteSummary(workspaceId: string) {
  const [total, pending, accepted, revoked, expired] = await Promise.all([
    prisma.workspaceInvite.count({ where: { workspaceId } }),
    prisma.workspaceInvite.count({ where: { workspaceId, status: "pending" } }),
    prisma.workspaceInvite.count({ where: { workspaceId, status: "accepted" } }),
    prisma.workspaceInvite.count({ where: { workspaceId, status: "revoked" } }),
    prisma.workspaceInvite.count({ where: { workspaceId, status: "expired" } }),
  ]);
  return { total, pending, accepted, revoked, expired };
}

async function getRecoveryOverrideSummary(workspaceId: string) {
  const memberIds = await prisma.workspaceMembership.findMany({
    where: { workspaceId, status: "active" },
    select: { userId: true },
  });
  const userIds = memberIds.map((m) => m.userId);
  if (userIds.length === 0) return { active: 0, expired: 0 };

  const [active, expired] = await Promise.all([
    prisma.providerRecoveryOverride.count({
      where: { userId: { in: userIds }, status: "active", expiresAt: { gt: new Date() } },
    }),
    prisma.providerRecoveryOverride.count({
      where: { userId: { in: userIds }, status: { not: "active" } },
    }),
  ]);
  return { active, expired };
}
