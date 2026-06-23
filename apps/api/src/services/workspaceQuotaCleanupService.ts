import { prisma } from "./prisma.js";
import { env } from "../config/env.js";

export interface QuotaCleanupInput {
  now?: Date;
  retentionDays?: number;
  batchSize?: number;
  dryRun?: boolean;
}

export interface QuotaCleanupResult {
  cutoff: string;
  scanned: number;
  deleted: number;
  dryRun: boolean;
}

export async function cleanupWorkspaceQuotaEvents(input: QuotaCleanupInput): Promise<QuotaCleanupResult> {
  const dryRun = input.dryRun ?? false;
  const now = input.now ?? new Date();
  const retentionDays = input.retentionDays ?? env.WORKSPACE_QUOTA_EVENT_RETENTION_DAYS;
  const batchSize = input.batchSize ?? env.WORKSPACE_QUOTA_EVENT_CLEANUP_BATCH_SIZE;

  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const scannedCount = await prisma.workspaceQuotaEvent.count({
    where: {
      createdAt: {
        lt: cutoffDate
      }
    }
  });

  let deletedCount = 0;

  if (!dryRun) {
    // Delete in batches sequentially
    let hasMore = true;
    while (hasMore) {
      const batchIds = await prisma.workspaceQuotaEvent.findMany({
        where: {
          createdAt: {
            lt: cutoffDate
          }
        },
        select: { id: true },
        take: batchSize
      });

      if (batchIds.length === 0) {
        hasMore = false;
        break;
      }

      const res = await prisma.workspaceQuotaEvent.deleteMany({
        where: {
          id: {
            in: batchIds.map((b) => b.id)
          }
        }
      });
      deletedCount += res.count;

      if (batchIds.length < batchSize) {
        hasMore = false;
      }
    }
  } else {
    deletedCount = scannedCount;
  }

  return {
    cutoff: cutoffDate.toISOString(),
    scanned: scannedCount,
    deleted: deletedCount,
    dryRun
  };
}
