import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { chatQueueConnection } from "./chatQueue.js";
import { expireOverrides } from "./providerRecoveryOverrideService.js";
import {
  PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
  recordSchedulerFailed,
  recordSchedulerFinished,
  recordSchedulerSkipped,
  recordSchedulerStarted
} from "./schedulerStatusService.js";

export interface ProviderRecoveryOverrideExpirySchedulerRunResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  scanned: number;
  expired: number;
  skipped: number;
  dryRun: false;
  errors: number;
  lockAcquired: boolean;
  lockMode: "redis" | "local_no_lock" | "skipped";
}

export class ProviderRecoveryOverrideExpiryScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private warnedAboutMissingLock = false;
  private readonly LOCK_KEY = "provider-recovery-overrides:expiry-lock";
  private readonly instanceId = randomUUID();

  public start(): void {
    if (!env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED) {
      console.log("Provider recovery override expiry scheduler is disabled by config.");
      void recordSchedulerSkipped({
        name: PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
        enabled: false,
        status: "disabled",
        reason: "disabled_by_config",
        lockAcquired: false,
        summary: { source: "scheduler", lock: "skipped" }
      });
      return;
    }

    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNext();
    console.log("Provider recovery override expiry scheduler started.");
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("Provider recovery override expiry scheduler stopped.");
  }

  private scheduleNext(): void {
    if (!this.isRunning) return;

    const nextRunMs = env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_INTERVAL_SECONDS * 1000;
    this.timer = setTimeout(async () => {
      try {
        await this.runOnce("interval");
      } catch (err) {
        console.error("Error in scheduled provider recovery override expiry run", err);
      } finally {
        this.scheduleNext();
      }
    }, nextRunMs);
  }

  public async runOnce(reason: "startup" | "interval" | "manual" = "manual"): Promise<ProviderRecoveryOverrideExpirySchedulerRunResult> {
    const startedAt = new Date();
    const result: ProviderRecoveryOverrideExpirySchedulerRunResult = {
      startedAt: startedAt.toISOString(),
      finishedAt: "",
      durationMs: 0,
      scanned: 0,
      expired: 0,
      skipped: 0,
      dryRun: false,
      errors: 0,
      lockAcquired: false,
      lockMode: "skipped"
    };

    let runWithoutLock = false;

    try {
      const acquired = await chatQueueConnection.set(
        this.LOCK_KEY,
        this.instanceId,
        "EX",
        env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_LOCK_TTL_SECONDS,
        "NX"
      );

      if (!acquired) {
        console.log("Provider recovery override expiry scheduler: skipped, lock held by another instance.");
        result.skipped++;
        this.finishResult(result, startedAt);
        await recordSchedulerSkipped({
          name: PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
          enabled: env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED,
          reason: "lock_held",
          lockAcquired: false,
          summary: this.resultSummary(result, "skipped")
        });
        return result;
      }

      result.lockAcquired = true;
      result.lockMode = "redis";
      await recordSchedulerStarted({
        name: PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
        enabled: env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED,
        lockAcquired: true
      });
    } catch (err) {
      if (env.NODE_ENV === "production") {
        console.error("Provider recovery override expiry scheduler: Redis lock unavailable; skipping production run.", err);
        result.errors++;
        result.skipped++;
        this.finishResult(result, startedAt);
        await recordSchedulerFailed({
          name: PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
          enabled: env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED,
          error: err,
          lockAcquired: false,
          summary: this.resultSummary(result, "unavailable")
        });
        return result;
      }

      runWithoutLock = true;
      result.lockMode = "local_no_lock";
      await recordSchedulerStarted({
        name: PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
        enabled: env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED,
        lockAcquired: false
      });
      if (!this.warnedAboutMissingLock) {
        this.warnedAboutMissingLock = true;
        console.warn("Provider recovery override expiry scheduler: Redis lock unavailable; running without distributed lock in local mode.");
      }
    }

    try {
      console.log(`Provider recovery override expiry scheduler run started (reason: ${reason})`);
      const summary = await expireOverrides({
        now: new Date(),
        limit: env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_MAX_PER_RUN
      });
      result.scanned = summary.scanned;
      result.expired = summary.expired;
      result.skipped = summary.skipped;
    } catch (err) {
      result.errors++;
      console.error("Provider recovery override expiry scheduler run failed", err);
      await recordSchedulerFailed({
        name: PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
        enabled: env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED,
        error: err,
        lockAcquired: result.lockAcquired,
        summary: this.resultSummary(result, result.lockMode === "redis" ? "acquired" : "unavailable")
      });
    } finally {
      if (result.lockAcquired && !runWithoutLock) {
        await this.releaseLock();
      }
    }

    console.log("Provider recovery override expiry scheduler run finished", {
      startedAt: result.startedAt,
      scanned: result.scanned,
      expired: result.expired,
      skipped: result.skipped,
      errors: result.errors,
      lockMode: result.lockMode
    });
    this.finishResult(result, startedAt);
    if (result.errors === 0) {
      await recordSchedulerFinished({
        name: PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
        enabled: env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED,
        lockAcquired: result.lockAcquired,
        summary: this.resultSummary(result, result.lockMode === "redis" ? "acquired" : "unavailable")
      });
    }
    return result;
  }

  private finishResult(
    result: ProviderRecoveryOverrideExpirySchedulerRunResult,
    startedAt: Date
  ): ProviderRecoveryOverrideExpirySchedulerRunResult {
    const finishedAt = new Date();
    result.finishedAt = finishedAt.toISOString();
    result.durationMs = finishedAt.getTime() - startedAt.getTime();
    return result;
  }

  private async releaseLock(): Promise<void> {
    try {
      const currentLock = await chatQueueConnection.get(this.LOCK_KEY);
      if (currentLock === this.instanceId) {
        await chatQueueConnection.del(this.LOCK_KEY);
      }
    } catch (err) {
      console.error("Failed to release provider recovery override expiry lock", err);
    }
  }

  private resultSummary(
    result: ProviderRecoveryOverrideExpirySchedulerRunResult,
    lock: "acquired" | "skipped" | "unavailable"
  ) {
    return {
      scanned: result.scanned,
      expired: result.expired,
      skipped: result.skipped,
      dryRun: result.dryRun,
      durationMs: result.durationMs,
      lock,
      source: "scheduler" as const
    };
  }
}

export const providerRecoveryOverrideExpiryScheduler = new ProviderRecoveryOverrideExpiryScheduler();
