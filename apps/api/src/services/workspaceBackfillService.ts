import { prisma } from "./prisma.js";

const WORKSPACE_MODELS = [
  "provider_connections",
  "provider_diagnostics_baselines",
  "provider_diagnostics_drift_alerts",
  "provider_recovery_policies",
  "provider_recovery_policy_runs",
  "provider_recovery_overrides",
  "provider_diagnostics_runs",
  "provider_health_incidents",
  "internal_api_keys",
  "internal_api_usage_logs",
  "user_model_preferences",
  "provider_rate_limit_settings",
  "notification_delivery_preferences",
  "notification_delivery_attempts",
  "notification_dead_letters",
  "notification_webhook_destinations"
];

export interface BackfillSummary {
  scanned: number;
  updated: number;
  skipped: number;
  unresolved: number;
  details: Record<string, {
    missingCount: number;
    updatedCount: number;
    unresolvedCount: number;
  }>;
}

export async function backfillWorkspaceIds({
  dryRun = false,
}: {
  dryRun?: boolean;
} = {}): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    scanned: 0,
    updated: 0,
    skipped: 0,
    unresolved: 0,
    details: {}
  };

  for (const table of WORKSPACE_MODELS) {
    summary.details[table] = {
      missingCount: 0,
      updatedCount: 0,
      unresolvedCount: 0
    };

    // 1. Find how many are missing workspaceId
    const missingResult = await prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM "${table}" WHERE "workspace_id" IS NULL AND "user_id" IS NOT NULL;`
    );
    // Cast appropriately since count is returned as BigInt by some drivers, or regular number
    const missingCount = Number(missingResult[0]?.count || 0);
    summary.details[table].missingCount = missingCount;
    summary.scanned += missingCount;

    if (missingCount > 0) {
      if (dryRun) {
        // In dry run, we assume we would update them all, but can't know unresolved without a heavy join.
        // For simplicity, we just mark them as skipped.
        summary.skipped += missingCount;
      } else {
        // Perform the update
        // We use an UPDATE with a subquery to get the user's workspace_id
        // We only update if the user has a workspace_id
        const updateResult = await prisma.$executeRawUnsafe(
          `UPDATE "${table}" 
           SET "workspace_id" = (SELECT "workspace_id" FROM "users" WHERE "users"."id" = "${table}"."user_id") 
           WHERE "workspace_id" IS NULL AND "user_id" IS NOT NULL
           AND EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "${table}"."user_id" AND "users"."workspace_id" IS NOT NULL);`
        );
        
        summary.updated += updateResult;
        summary.details[table].updatedCount = updateResult;

        // Check if any remain unresolved
        const unresolvedResult = await prisma.$queryRawUnsafe<{ count: number }[]>(
          `SELECT COUNT(*) as count FROM "${table}" WHERE "workspace_id" IS NULL;`
        );
        const unresolvedCount = Number(unresolvedResult[0]?.count || 0);
        summary.unresolved += unresolvedCount;
        summary.details[table].unresolvedCount = unresolvedCount;
      }
    }
  }

  return summary;
}
