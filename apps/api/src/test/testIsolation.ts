import { prisma } from "../services/prisma.js";
import { ensureDefaultWorkspace } from "../services/workspaceService.js";

/**
 * Generates a deterministic run ID using process metadata to avoid conflicts
 * across parallel test workers.
 */
export function makeTestRunId(prefix: string): string {
  const poolId = process.env.VITEST_POOL_ID || "0";
  const pid = process.pid;
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${prefix}-${poolId}-${pid}-${suffix}`;
}

/**
 * Generates a distinct test user ID.
 */
export function makeTestUserId(prefix: string): string {
  return `user-${makeTestRunId(prefix)}`;
}

/**
 * Generates a distinct test email.
 */
export function makeTestEmail(prefix: string): string {
  return `${makeTestUserId(prefix)}@test.local`;
}

/**
 * Central cleanup logic that deletes all related records for a specific userId 
 * in the correct referential integrity order.
 * NEVER uses global deleteMany({}).
 */
export async function cleanupTestUserData(userId: string): Promise<void> {
  // Ordered from leaf nodes to root nodes to respect foreign key constraints.
  
  // 1. Api Key Scopes and Usage Logs
  await prisma.internalApiKeyModelScope.deleteMany({
    where: { apiKey: { userId } }
  });
  await prisma.internalApiUsageLog.deleteMany({ where: { userId } });
  await prisma.internalApiKey.deleteMany({ where: { userId } });

  // 2. Notifications
  await prisma.notificationDeliveryAttempt.deleteMany({
    where: { userId }
  });
  await prisma.notificationDeadLetter.deleteMany({
    where: { userId }
  });
  await prisma.notificationEvent.deleteMany({ where: { userId } });
  await prisma.notificationWebhookDestination.deleteMany({ where: { userId } });
  await prisma.notificationDeliveryPreference.deleteMany({ where: { userId } });

  // 3. Provider Settings & Cache & History
  await prisma.providerDiagnosticsDriftAlert.deleteMany({ where: { userId } });
  await prisma.providerDiagnosticsBaseline.deleteMany({ where: { userId } });
  await prisma.providerDiagnosticsRun.deleteMany({ where: { userId } });
  await prisma.providerRecoveryOverride.deleteMany({ where: { userId } });
  await prisma.providerRecoveryPolicyRun.deleteMany({ where: { userId } });
  await prisma.providerRecoveryPolicy.deleteMany({ where: { userId } });
  await prisma.providerConnection.deleteMany({ where: { userId } });
  await prisma.providerRateLimitSetting.deleteMany({ where: { userId } });
  await prisma.providerLiveSubModelCache.deleteMany({ where: { userId } });

  // 4. Conversations
  await prisma.message.deleteMany({ where: { userId } });
  await prisma.chatThread.deleteMany({ where: { userId } });

  // 5. Settings and User
  await prisma.userModelPreference.deleteMany({ where: { userId } });
  await prisma.userSettings.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.userRoleAuditEvent.deleteMany({
    where: {
      OR: [
        { actorUserId: userId },
        { targetUserId: userId }
      ]
    }
  });
  await prisma.automationJob.deleteMany({ where: { userId } });
  
  await prisma.providerHealthIncident.deleteMany({ where: { userId } });
  
  // 6. Workspace Memberships and Invites
  // First find workspaces this user belongs to, so we can clean them up after membership/user is gone.
  // We only clean up non-default workspaces to avoid breaking global fallback state.
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    select: { workspaceId: true }
  });
  const testWorkspaceIds = memberships.map(m => m.workspaceId);

  await prisma.workspaceMembership.deleteMany({ where: { userId } });
  // We can't cleanly delete WorkspaceInvite by userId because it uses email, 
  // but we can query by email if needed, or assume it's cleaned manually if tied strictly to an email.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (user?.email) {
    await prisma.workspaceInvite.deleteMany({ where: { email: user.email } });
  }

  // Finally, the user record itself
  await prisma.user.deleteMany({ where: { id: userId } });

  // Clean up any dynamically created workspaces
  if (testWorkspaceIds.length > 0) {
    await prisma.workspace.deleteMany({
      where: {
        id: { in: testWorkspaceIds },
        slug: { not: "local" }
      }
    });
  }
}

/**
 * Creates and returns an isolated user scope object that includes an 
 * automated, safe cleanup callback.
 * 
 * This is synchronous for backward compatibility. Tests that need
 * workspaceId should use withTestUserScopeAsync instead.
 */
export function withTestUserScope(prefix: string) {
  const runId = makeTestRunId(prefix);
  const userId = `user-${runId}`;
  const email = `${userId}@test.local`;

  return {
    runId,
    userId,
    email,
    cleanup: async () => {
      await cleanupTestUserData(userId);
    }
  };
}

/**
 * Async version that also ensures the default workspace exists
 * and returns its ID. Use this in tests that need workspace scoping.
 */
export async function withTestUserScopeAsync(prefix: string) {
  const scope = withTestUserScope(prefix);
  const workspace = await ensureDefaultWorkspace();

  return {
    ...scope,
    workspaceId: workspace.id
  };
}
