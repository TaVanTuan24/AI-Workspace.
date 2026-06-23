import { prisma } from "./prisma.js";
import { materializeNotificationEvent } from "./notificationEventService.js";
import { getNotificationPreferences } from "./notificationPreferenceService.js";
import { getWorkspaceUsageSummary } from "./workspaceQuotaService.js";

interface BaseAlertContext {
  workspaceId: string;
  actorUserId?: string | null;
  resource: string;
  limit: number;
  used: number;
  source: string;
}

interface WarningAlertContext extends BaseAlertContext {}

interface ExceededAlertContext extends BaseAlertContext {
  attemptedIncrement: number;
}

function getTodayString() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

function getHourlyString() {
  const d = new Date();
  return `${getTodayString()}-${String(d.getUTCHours()).padStart(2, "0")}`;
}

async function getWorkspaceAdminsAndOwner(workspaceId: string) {
  const memberships = await prisma.workspaceMembership.findMany({
    where: {
      workspaceId,
      role: { in: ["owner", "admin"] },
      status: "active"
    },
    select: { userId: true }
  });
  return memberships.map((m) => m.userId);
}

export async function maybeCreateQuotaWarningAlert(ctx: WarningAlertContext): Promise<number> {
  let createdCount = 0;
  try {
    const userIds = await getWorkspaceAdminsAndOwner(ctx.workspaceId);
    if (userIds.length === 0) return 0;

    for (const userId of userIds) {
      const settings = await getNotificationPreferences(userId);
      if (!settings.notifyWorkspaceQuotaWarnings) continue;

      const thresholdPercent = settings.workspaceQuotaWarningThresholdPercent;
      const currentPercent = (ctx.used / ctx.limit) * 100;
      
      // Warning condition: usage crossed threshold but is not exceeded yet.
      if (currentPercent >= thresholdPercent && ctx.used <= ctx.limit) {
        const fingerprint = `quota:${ctx.workspaceId}:${ctx.resource}:warning:${getTodayString()}`;
        
        const count = await prisma.notificationEvent.count({
          where: { userId, fingerprint }
        });

        if (count === 0) {
          createdCount++;
        }

        await materializeNotificationEvent(userId, {
          id: fingerprint,
          kind: "workspace_quota_warning" as any,
          severity: "warning",
          title: "Workspace quota nearing limit",
          message: `${ctx.resource} is at ${ctx.used}/${ctx.limit}.`,
          fingerprint,
          action: {
            label: "View Quota",
            href: "/settings/quota"
          },
          dismissible: true,
          createdFromStatusAt: null
        });
      }
    }
  } catch (error) {
    console.error(`[QuotaAlertService] Failed to create warning alert for ${ctx.workspaceId}`, error);
  }
  return createdCount;
}

export async function maybeCreateQuotaExceededAlert(ctx: ExceededAlertContext): Promise<number> {
  let createdCount = 0;
  try {
    const userIds = await getWorkspaceAdminsAndOwner(ctx.workspaceId);
    if (userIds.length === 0) return 0;

    const fingerprint = `quota:${ctx.workspaceId}:${ctx.resource}:exceeded:${getHourlyString()}`;

    for (const userId of userIds) {
      const settings = await getNotificationPreferences(userId);
      if (!settings.notifyWorkspaceQuotaExceeded) continue;

      const count = await prisma.notificationEvent.count({
        where: { userId, fingerprint }
      });

      if (count === 0) {
        createdCount++;
      }

      await materializeNotificationEvent(userId, {
        id: fingerprint,
        kind: "workspace_quota_exceeded" as any,
        severity: "critical",
        title: "Workspace quota exceeded",
        message: `${ctx.resource} quota was exceeded. The attempted action was blocked.`,
        fingerprint,
        action: {
          label: "View Quota",
          href: "/settings/quota"
        },
        dismissible: true,
        createdFromStatusAt: null
      });
    }
  } catch (error) {
    console.error(`[QuotaAlertService] Failed to create exceeded alert for ${ctx.workspaceId}`, error);
  }
  return createdCount;
}

export async function evaluateWorkspaceQuotaThresholds(params: {
  workspaceId: string;
  now: Date;
}): Promise<{ warningsCreated: number; exceededCreated: number }> {
  let warningsCreated = 0;
  let exceededCreated = 0;

  try {
    const summary = await getWorkspaceUsageSummary({
      workspaceId: params.workspaceId,
      now: params.now
    });

    for (const quota of summary.quotas) {
      if (quota.limit === null) continue;

      if (quota.exceeded) {
        exceededCreated += await maybeCreateQuotaExceededAlert({
          workspaceId: params.workspaceId,
          resource: quota.resource,
          limit: quota.limit,
          used: quota.used,
          source: "scheduler",
          attemptedIncrement: 0
        });
      } else {
        warningsCreated += await maybeCreateQuotaWarningAlert({
          workspaceId: params.workspaceId,
          resource: quota.resource,
          limit: quota.limit,
          used: quota.used,
          source: "scheduler"
        });
      }
    }
  } catch (error) {
    console.error(`[QuotaAlertService] Failed to evaluate workspace quota thresholds for ${params.workspaceId}`, error);
  }

  return { warningsCreated, exceededCreated };
}
