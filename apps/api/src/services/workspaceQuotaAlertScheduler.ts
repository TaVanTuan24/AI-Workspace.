import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "./prisma.js";
import { chatQueueConnection } from "./chatQueue.js";
import { evaluateWorkspaceQuotaThresholds } from "./workspaceQuotaAlertService.js";
import {
  recordSchedulerFailed,
  recordSchedulerFinished,
  recordSchedulerSkipped,
  recordSchedulerStarted
} from "./schedulerStatusService.js";

export const WORKSPACE_QUOTA_ALERT_SCHEDULER_NAME = "workspace_quota_alerts";

export interface WorkspaceQuotaAlertSchedulerRunResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  scannedWorkspaces: number;
  warningsCreated: number;
  exceededCreated: number;
  skipped: number;
  dryRun: false;
  errors: number;
  lockAcquired: boolean;
  lockMode: "redis" | "local_no_lock" | "skipped";
}

export class WorkspaceQuotaAlertScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private warnedAboutMissingLock = false;
  private readonly LOCK_KEY = "workspace-quota-alerts:lock";
  private readonly instanceId = randomUUID();

  public start(): void {
    if (!env.WORKSPACE_QUOTA_ALERT_SCHEDULER_ENABLED) {
      console.log("Workspace quota alert scheduler is disabled by config.");
      void recordSchedulerSkipped({
        name: WORKSPACE_QUOTA_ALERT_SCHEDULER_NAME,
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
    console.log("Workspace quota alert scheduler started.");
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("Workspace quota alert scheduler stopped.");
  }

  private scheduleNext(): void {
    if (!this.isRunning) return;

    const nextRunMs = env.WORKSPACE_QUOTA_ALERT_INTERVAL_SECONDS * 1000;
    this.timer = setTimeout(async () => {
      try {
        await this.runOnce("interval");
      } catch (err) {
        console.error("Error in scheduled workspace quota alert run", err);
      } finally {
        this.scheduleNext();
      }
    }, nextRunMs);
  }

  public async runOnce(reason: "startup" | "interval" | "manual" = "manual"): Promise<WorkspaceQuotaAlertSchedulerRunResult> {
    const startedAt = new Date();
    const result: WorkspaceQuotaAlertSchedulerRunResult = {
      startedAt: startedAt.toISOString(),
      finishedAt: "",
      durationMs: 0,
      scannedWorkspaces: 0,
      warningsCreated: 0,
      exceededCreated: 0,
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
        env.WORKSPACE_QUOTA_ALERT_LOCK_TTL_SECONDS,
        "NX"
      );

      if (!acquired) {
        console.log("Workspace quota alert scheduler: skipped, lock held by another instance.");
        result.skipped++;
        this.finishResult(result, startedAt);
        await recordSchedulerSkipped({
          name: WORKSPACE_QUOTA_ALERT_SCHEDULER_NAME,
          enabled: env.WORKSPACE_QUOTA_ALERT_SCHEDULER_ENABLED,
          reason: "lock_held",
          lockAcquired: false,
          summary: this.resultSummary(result, "skipped")
        });
        return result;
      }

      result.lockAcquired = true;
      result.lockMode = "redis";
      await recordSchedulerStarted({
        name: WORKSPACE_QUOTA_ALERT_SCHEDULER_NAME,
        enabled: env.WORKSPACE_QUOTA_ALERT_SCHEDULER_ENABLED,
        lockAcquired: true
      });
    } catch (err) {
      if (env.NODE_ENV === "production") {
        console.error("Workspace quota alert scheduler: Redis lock unavailable; skipping production run.", err);
        result.errors++;
        result.skipped++;
        this.finishResult(result, startedAt);
        await recordSchedulerFailed({
          name: WORKSPACE_QUOTA_ALERT_SCHEDULER_NAME,
          enabled: env.WORKSPACE_QUOTA_ALERT_SCHEDULER_ENABLED,
          error: err,
          lockAcquired: false,
          summary: this.resultSummary(result, "unavailable")
        });
        return result;
      }

      runWithoutLock = true;
      result.lockMode = "local_no_lock";
      await recordSchedulerStarted({
        name: WORKSPACE_QUOTA_ALERT_SCHEDULER_NAME,
        enabled: env.WORKSPACE_QUOTA_ALERT_SCHEDULER_ENABLED,
        lockAcquired: false
      });
      if (!this.warnedAboutMissingLock) {
        this.warnedAboutMissingLock = true;
        console.warn("Workspace quota alert scheduler: Redis lock unavailable; running without distributed lock in local mode.");
      }
    }

    try {
      console.log(`Workspace quota alert scheduler run started (reason: ${reason})`);
      
      const workspaces = await prisma.workspace.findMany({
        take: env.WORKSPACE_QUOTA_ALERT_MAX_WORKSPACES_PER_RUN,
        select: { id: true }
      });
      
      result.scannedWorkspaces = workspaces.length;
      const now = new Date();

      for (const workspace of workspaces) {
        try {
          const counts = await evaluateWorkspaceQuotaThresholds({
            workspaceId: workspace.id,
            now
          });
          result.warningsCreated += counts.warningsCreated;
          result.exceededCreated += counts.exceededCreated;
        } catch (err) {
          result.errors++;
          console.error(`Error evaluating quota alerts for workspace ${workspace.id}`, err);
        }
      }
    } catch (err) {
      result.errors++;
      console.error("Workspace quota alert scheduler run failed", err);
      await recordSchedulerFailed({
        name: WORKSPACE_QUOTA_ALERT_SCHEDULER_NAME,
        enabled: env.WORKSPACE_QUOTA_ALERT_SCHEDULER_ENABLED,
        error: err,
        lockAcquired: result.lockAcquired,
        summary: this.resultSummary(result, result.lockMode === "redis" ? "acquired" : "unavailable")
      });
    } finally {
      if (result.lockAcquired && !runWithoutLock) {
        await this.releaseLock();
      }
    }

    console.log("Workspace quota alert scheduler run finished", {
      startedAt: result.startedAt,
      scannedWorkspaces: result.scannedWorkspaces,
      warningsCreated: result.warningsCreated,
      exceededCreated: result.exceededCreated,
      skipped: result.skipped,
      errors: result.errors,
      lockMode: result.lockMode
    });
    this.finishResult(result, startedAt);
    if (result.errors === 0) {
      await recordSchedulerFinished({
        name: WORKSPACE_QUOTA_ALERT_SCHEDULER_NAME,
        enabled: env.WORKSPACE_QUOTA_ALERT_SCHEDULER_ENABLED,
        lockAcquired: result.lockAcquired,
        summary: this.resultSummary(result, result.lockMode === "redis" ? "acquired" : "unavailable")
      });
    }
    return result;
  }

  private finishResult(
    result: WorkspaceQuotaAlertSchedulerRunResult,
    startedAt: Date
  ): WorkspaceQuotaAlertSchedulerRunResult {
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
      console.error("Failed to release workspace quota alert lock", err);
    }
  }

  private resultSummary(
    result: WorkspaceQuotaAlertSchedulerRunResult,
    lock: "acquired" | "skipped" | "unavailable"
  ) {
    return {
      scannedWorkspaces: result.scannedWorkspaces,
      warningsCreated: result.warningsCreated,
      exceededCreated: result.exceededCreated,
      skipped: result.skipped,
      durationMs: result.durationMs,
      lock,
      source: "scheduler" as const
    };
  }
}

export const workspaceQuotaAlertScheduler = new WorkspaceQuotaAlertScheduler();
