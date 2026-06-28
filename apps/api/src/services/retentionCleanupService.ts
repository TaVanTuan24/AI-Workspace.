import { cleanupUsageLogs } from "./apiUsageCleanupService.js";
import { deleteOldNotificationEvents } from "./notificationEventService.js";

export interface RetentionCleanupResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  usage: { matched: number; deleted: number };
  notifications: { matched: number; deleted: number };
}

/**
 * Runs the high-volume retention deletions that have first-class services and
 * env-backed retention windows: internal API usage logs
 * (API_USAGE_RETENTION_DAYS) and notification events
 * (NOTIFICATION_EVENT_RETENTION_DAYS). Composes the existing single-source
 * cleanup functions so behaviour matches the manual `*:cleanup` scripts.
 *
 * Lower-volume diagnostics/incident cleanups remain manual (`provider-*:cleanup`).
 */
export async function runRetentionCleanup(
  { dryRun = false }: { dryRun?: boolean } = {},
  now: Date = new Date()
): Promise<RetentionCleanupResult> {
  const startedAt = now;

  const usage = await cleanupUsageLogs({ dryRun });
  const notifications = await deleteOldNotificationEvents({ dryRun });

  const finishedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    dryRun,
    usage: { matched: usage.matchedCount, deleted: usage.deletedCount },
    notifications: { matched: notifications.matchedCount, deleted: notifications.deletedCount }
  };
}
