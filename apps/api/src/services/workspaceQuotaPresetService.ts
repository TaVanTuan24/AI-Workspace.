import { prisma } from "./prisma.js";
import { getWorkspaceUsageSummary } from "./workspaceQuotaService.js";
import { recordUserRoleAuditEvent } from "./userManagementService.js";

export interface QuotaPreset {
  label: string;
  description?: string;
  quotas: {
    maxMembers: number | null;
    maxInvites: number | null;
    maxApiKeys: number | null;
    maxProviderConnections: number | null;
    maxDiagnosticsBaselines: number | null;
    maxMonthlyApiRequests: number | null;
    maxMonthlyInviteEmails: number | null;
  };
}

export const WORKSPACE_QUOTA_PRESETS: Record<string, QuotaPreset> = {
  local: {
    label: "Local / Unlimited",
    description: "Default self-hosted mode with unlimited resources.",
    quotas: {
      maxMembers: null,
      maxInvites: null,
      maxApiKeys: null,
      maxProviderConnections: null,
      maxDiagnosticsBaselines: null,
      maxMonthlyApiRequests: null,
      maxMonthlyInviteEmails: null
    }
  },
  starter: {
    label: "Starter",
    description: "Standard starter tier for small teams.",
    quotas: {
      maxMembers: 3,
      maxInvites: 10,
      maxApiKeys: 3,
      maxProviderConnections: 3,
      maxDiagnosticsBaselines: 5,
      maxMonthlyApiRequests: 1000,
      maxMonthlyInviteEmails: 50
    }
  },
  team: {
    label: "Team",
    description: "Expanded tier for active team collaboration.",
    quotas: {
      maxMembers: 10,
      maxInvites: 50,
      maxApiKeys: 10,
      maxProviderConnections: 10,
      maxDiagnosticsBaselines: 50,
      maxMonthlyApiRequests: 10000,
      maxMonthlyInviteEmails: 500
    }
  }
};

export interface ApplyPresetInput {
  actorUserId: string;
  workspaceId: string;
  presetId: string;
  confirmExceeded?: boolean;
}

export interface ApplyPresetResult {
  success: boolean;
  warning?: "quota_preset_would_exceed_usage";
  exceededResources?: Array<{
    resource: string;
    used: number;
    newLimit: number;
  }>;
}

export async function applyWorkspaceQuotaPreset(input: ApplyPresetInput): Promise<ApplyPresetResult> {
  const { actorUserId, workspaceId, presetId, confirmExceeded } = input;

  const preset = WORKSPACE_QUOTA_PRESETS[presetId];
  if (!preset) {
    throw new Error("Invalid preset ID");
  }

  // Ensure actor is an owner
  const membership = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actorUserId } }
  });
  if (!membership || membership.role !== "owner") {
    throw new Error("Permission denied: only workspace owners can apply quota presets");
  }

  // 4. Pre-flight check: evaluate current usage summary against the target preset
  const usageSummary = await getWorkspaceUsageSummary({ workspaceId });
  const exceededResources = [];

  const presetLimitsMap: Record<string, number | null> = {
    members: preset.quotas.maxMembers,
    invites: preset.quotas.maxInvites,
    api_keys: preset.quotas.maxApiKeys,
    provider_connections: preset.quotas.maxProviderConnections,
    diagnostics_baselines: preset.quotas.maxDiagnosticsBaselines,
    monthly_api_requests: preset.quotas.maxMonthlyApiRequests,
    monthly_invite_emails: preset.quotas.maxMonthlyInviteEmails
  };

  for (const [resource, limit] of Object.entries(presetLimitsMap)) {
    if (limit === null) continue; // Unlimited is always safe

    // Find current usage for this resource
    const resourceQuota = usageSummary.quotas.find(q => q.resource === resource);
    if (!resourceQuota) continue;

    if (resourceQuota.used > limit) {
      exceededResources.push({
        resource,
        used: resourceQuota.used,
        newLimit: limit
      });
    }
  }

  if (exceededResources.length > 0 && !confirmExceeded) {
    return {
      success: false,
      warning: "quota_preset_would_exceed_usage",
      exceededResources
    };
  }

  // Apply the preset
  await prisma.workspaceQuota.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      plan: presetId,
      ...preset.quotas
    },
    update: {
      plan: presetId,
      ...preset.quotas
    }
  });

  // Record audit event
  await recordUserRoleAuditEvent({
    workspaceId,
    actorUserId,
    action: "apply_quota_preset",
    nextStatus: presetId
  });

  return { success: true };
}
