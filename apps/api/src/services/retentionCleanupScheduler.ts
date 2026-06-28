import { env } from "../config/env.js";
import { chatQueueConnection } from "./chatQueue.js";
import { runRetentionCleanup } from "./retentionCleanupService.js";
import {
  recordSchedulerStarted,
  recordSchedulerFinished,
  recordSchedulerSkipped,
  recordSchedulerFailed
} from "./schedulerStatusService.js";
import { randomUUID } from "node:crypto";

export const RETENTION_CLEANUP_SCHEDULER_NAME = "retention_cleanup";

/**
 * Periodically purges expired usage logs and notification events. Mirrors the
 * provider-health scheduler: env-gated, single-flight via a Redis lock so
 * replicas never double-run, and observable through schedulerStatusService.
 */
export class RetentionCleanupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly LOCK_KEY = "retention-cleanup-scheduler:lock";
  private instanceId = randomUUID();

  public start(): void {
    if (!env.RETENTION_CLEANUP_SCHEDULER_ENABLED) {
      console.log("Retention cleanup scheduler is disabled by config.");
      return;
    }
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNext();
    console.log("Retention cleanup scheduler started.");
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("Retention cleanup scheduler stopped.");
  }

  private scheduleNext(): void {
    if (!this.isRunning) return;
    const nextRunMs = env.RETENTION_CLEANUP_INTERVAL_SECONDS * 1000;
    this.timer = setTimeout(async () => {
      try {
        await this.runOnce("interval");
      } catch (err) {
        console.error("Error in scheduled retention cleanup run", err);
      } finally {
        this.scheduleNext();
      }
    }, nextRunMs);
  }

  public async runOnce(reason: "startup" | "interval" | "manual" = "manual"): Promise<void> {
    const enabled = env.RETENTION_CLEANUP_SCHEDULER_ENABLED;
    const lockTtl = env.RETENTION_CLEANUP_LOCK_TTL_SECONDS;
    const acquired = await chatQueueConnection.set(this.LOCK_KEY, this.instanceId, "EX", lockTtl, "NX");

    if (!acquired) {
      await recordSchedulerSkipped({
        name: RETENTION_CLEANUP_SCHEDULER_NAME,
        enabled,
        reason: "lock held by another instance",
        lockAcquired: false
      });
      return;
    }

    await recordSchedulerStarted({ name: RETENTION_CLEANUP_SCHEDULER_NAME, enabled, lockAcquired: true });

    try {
      console.log(`Retention cleanup scheduler run started (reason: ${reason})`);
      const result = await runRetentionCleanup({ dryRun: false });
      await recordSchedulerFinished({
        name: RETENTION_CLEANUP_SCHEDULER_NAME,
        enabled,
        lockAcquired: true,
        summary: {
          usageDeleted: result.usage.deleted,
          notificationsDeleted: result.notifications.deleted,
          durationMs: result.durationMs
        }
      });
      console.log("Retention cleanup scheduler run finished", result);
    } catch (err) {
      await recordSchedulerFailed({ name: RETENTION_CLEANUP_SCHEDULER_NAME, enabled, error: err, lockAcquired: true });
      throw err;
    } finally {
      try {
        const currentLock = await chatQueueConnection.get(this.LOCK_KEY);
        if (currentLock === this.instanceId) {
          await chatQueueConnection.del(this.LOCK_KEY);
        }
      } catch (err) {
        console.error("Failed to release retention cleanup lock", err);
      }
    }
  }
}

export const retentionCleanupScheduler = new RetentionCleanupScheduler();
