import { prisma } from "./prisma.js";
import { env } from "../config/env.js";

export interface CleanupInput {
  olderThanDays?: number;
  before?: Date;
  dryRun?: boolean;
}

export interface CleanupResult {
  dryRun: boolean;
  retentionDays?: number;
  cutoffDate: string;
  matchedCount: number;
  deletedCount: number;
}

export async function cleanupUsageLogs(input: CleanupInput): Promise<CleanupResult> {
  const dryRun = input.dryRun ?? false;
  
  let cutoffDate: Date;
  let retentionDays: number | undefined = undefined;

  if (input.before) {
    if (isNaN(input.before.getTime())) {
      throw new Error("Invalid 'before' date provided.");
    }
    cutoffDate = input.before;
  } else {
    retentionDays = input.olderThanDays ?? env.API_USAGE_RETENTION_DAYS;
    if (typeof retentionDays !== 'number' || isNaN(retentionDays) || retentionDays < 0) {
      throw new Error("Retention days must be a positive number.");
    }
    cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  }

  const matchedCount = await prisma.internalApiUsageLog.count({
    where: {
      createdAt: {
        lt: cutoffDate
      }
    }
  });

  let deletedCount = 0;
  if (!dryRun) {
    const res = await prisma.internalApiUsageLog.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate
        }
      }
    });
    deletedCount = res.count;
  }

  return {
    dryRun,
    retentionDays,
    cutoffDate: cutoffDate.toISOString(),
    matchedCount,
    deletedCount
  };
}
