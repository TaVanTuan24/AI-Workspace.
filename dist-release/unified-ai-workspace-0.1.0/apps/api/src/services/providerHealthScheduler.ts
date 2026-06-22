import { env } from "../config/env.js";
import { chatQueueConnection } from "./chatQueue.js";
import { prisma } from "./prisma.js";
import { refreshProviderHealth } from "./providerHealthService.js";
import { randomUUID } from "node:crypto";
import type { ProviderId } from "@uaiw/shared/types/provider.js";

export interface ProviderHealthSchedulerRunResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  checkedUsers: number;
  checkedConnections: number;
  healthy: number;
  requiresLogin: number;
  errors: number;
  skipped: number;
}

export class ProviderHealthScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly LOCK_KEY = "provider-health-scheduler:lock";
  private instanceId = randomUUID();

  public start(): void {
    if (!env.PROVIDER_HEALTH_SCHEDULER_ENABLED) {
      console.log("Provider health scheduler is disabled by config.");
      return;
    }

    if (this.isRunning) return;
    this.isRunning = true;

    this.scheduleNext();
    console.log("Provider health scheduler started.");
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("Provider health scheduler stopped.");
  }

  private scheduleNext(): void {
    if (!this.isRunning) return;

    const baseMs = env.PROVIDER_HEALTH_SCHEDULER_INTERVAL_SECONDS * 1000;
    const jitterMs = Math.random() * env.PROVIDER_HEALTH_SCHEDULER_JITTER_SECONDS * 1000;
    const nextRunMs = baseMs + jitterMs;

    this.timer = setTimeout(async () => {
      try {
        await this.runOnce("interval");
      } catch (err) {
        console.error("Error in scheduled provider health run", err);
      } finally {
        this.scheduleNext();
      }
    }, nextRunMs);
  }

  public async runOnce(reason: "startup" | "interval" | "manual" = "manual"): Promise<ProviderHealthSchedulerRunResult> {
    const startedAt = new Date();
    const result: ProviderHealthSchedulerRunResult = {
      startedAt: startedAt.toISOString(),
      finishedAt: "",
      durationMs: 0,
      checkedUsers: 0,
      checkedConnections: 0,
      healthy: 0,
      requiresLogin: 0,
      errors: 0,
      skipped: 0
    };

    // 1. Acquire Redis Lock
    const lockTtl = env.PROVIDER_HEALTH_SCHEDULER_LOCK_TTL_SECONDS;
    const acquired = await chatQueueConnection.set(this.LOCK_KEY, this.instanceId, "EX", lockTtl, "NX");
    
    if (!acquired) {
      console.log("Provider health scheduler: skipped, lock held by another instance.");
      result.skipped++;
      result.finishedAt = new Date().toISOString();
      return result;
    }

    try {
      console.log(`Provider health scheduler run started (reason: ${reason})`);

      // 2. Query users with connected providers
      const maxUsers = env.PROVIDER_HEALTH_SCHEDULER_MAX_USERS_PER_RUN;
      
      const connections = await prisma.providerConnection.findMany({
        where: {
          status: { in: ["connected", "healthy"] },
          encryptedSessionBlob: { not: null }
        },
        // We group by userId in memory to avoid complex raw queries if possible,
        // but we'll fetch a batch. To truly respect max users, we should distinct users.
        distinct: ["userId"],
        take: maxUsers,
        select: { userId: true }
      });

      result.checkedUsers = connections.length;

      for (const { userId } of connections) {
        const userConnections = await prisma.providerConnection.findMany({
          where: {
            userId,
            status: { in: ["connected", "healthy"] },
            encryptedSessionBlob: { not: null }
          }
        });

        for (const conn of userConnections) {
          result.checkedConnections++;
          try {
            const health = await refreshProviderHealth(userId, conn.provider as ProviderId);
            if (health.connectionStatus === "connected" || health.connectionStatus === "healthy") {
              result.healthy++;
            } else if (health.connectionStatus === "requires_login") {
              result.requiresLogin++;
            } else {
              result.errors++;
            }
          } catch (err: any) {
            console.error(`Provider health refresh failed for connection userId=${userId} provider=${conn.provider}`, err);
            result.errors++;
          }
        }
      }

    } finally {
      const finishedAt = new Date();
      result.finishedAt = finishedAt.toISOString();
      result.durationMs = finishedAt.getTime() - startedAt.getTime();

      // Release Lock if we still hold it
      try {
        const currentLock = await chatQueueConnection.get(this.LOCK_KEY);
        if (currentLock === this.instanceId) {
          await chatQueueConnection.del(this.LOCK_KEY);
        }
      } catch (err) {
        console.error("Failed to release provider health lock", err);
      }

      console.log("Provider health scheduler run finished", result);
    }

    return result;
  }
}

export const providerHealthScheduler = new ProviderHealthScheduler();
