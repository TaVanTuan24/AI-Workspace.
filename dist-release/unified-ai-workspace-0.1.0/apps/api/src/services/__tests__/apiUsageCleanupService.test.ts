import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../prisma.js";
import { cleanupUsageLogs } from "../apiUsageCleanupService.js";
import { env } from "../../config/env.js";

describe("apiUsageCleanupService", () => {
  const userId = "test-user-usage-cleanup";

  beforeEach(async () => {
    await prisma.internalApiUsageLog.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });

    await prisma.user.create({
      data: {
        id: userId,
        email: "cleanup-test@local.com"
      }
    });

    const now = new Date();
    
    // Log 1: Very old (40 days ago)
    const oldDate1 = new Date(now);
    oldDate1.setDate(now.getDate() - 40);
    await prisma.internalApiUsageLog.create({
      data: {
        userId,
        model: "gpt-4",
        provider: "chatgpt",
        endpoint: "/v1/chat/completions",
        requestId: "req-old-1",
        status: "completed",
        stream: false,
        messageCount: 1,
        inputCharCount: 10,
        createdAt: oldDate1
      }
    });

    // Log 2: Mildly old (20 days ago)
    const oldDate2 = new Date(now);
    oldDate2.setDate(now.getDate() - 20);
    await prisma.internalApiUsageLog.create({
      data: {
        userId,
        model: "gpt-4",
        provider: "chatgpt",
        endpoint: "/v1/chat/completions",
        requestId: "req-old-2",
        status: "completed",
        stream: false,
        messageCount: 1,
        inputCharCount: 10,
        createdAt: oldDate2
      }
    });

    // Log 3: Recent (2 days ago)
    const recentDate = new Date(now);
    recentDate.setDate(now.getDate() - 2);
    await prisma.internalApiUsageLog.create({
      data: {
        userId,
        model: "gpt-4",
        provider: "chatgpt",
        endpoint: "/v1/chat/completions",
        requestId: "req-recent-1",
        status: "completed",
        stream: false,
        messageCount: 1,
        inputCharCount: 10,
        createdAt: recentDate
      }
    });
  });

  afterEach(async () => {
    await prisma.internalApiUsageLog.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("should dry-run count but not delete anything", async () => {
    const result = await cleanupUsageLogs({
      dryRun: true,
      olderThanDays: 30
    });
    
    expect(result.dryRun).toBe(true);
    expect(result.matchedCount).toBe(1); // Only Log 1 is > 30 days
    expect(result.deletedCount).toBe(0);

    const remaining = await prisma.internalApiUsageLog.count({ where: { userId } });
    expect(remaining).toBe(3);
  });

  it("should delete old logs using olderThanDays", async () => {
    const result = await cleanupUsageLogs({
      dryRun: false,
      olderThanDays: 15
    });

    expect(result.dryRun).toBe(false);
    expect(result.matchedCount).toBe(2); // Log 1 (40) and Log 2 (20) are > 15 days
    expect(result.deletedCount).toBe(2);

    const remaining = await prisma.internalApiUsageLog.count({ where: { userId } });
    expect(remaining).toBe(1); // Only recent remains
  });

  it("should use env retention days if olderThanDays is not provided", async () => {
    env.API_USAGE_RETENTION_DAYS = 30; // Override env for test
    const result = await cleanupUsageLogs({
      dryRun: false
    });

    expect(result.matchedCount).toBe(1); // Only Log 1 > 30 days
    expect(result.deletedCount).toBe(1);
    
    const remaining = await prisma.internalApiUsageLog.count({ where: { userId } });
    expect(remaining).toBe(2);
  });

  it("should override days if before date is provided", async () => {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(now.getDate() - 10); // cutoff 10 days ago

    const result = await cleanupUsageLogs({
      dryRun: false,
      before: cutoff
    });

    expect(result.matchedCount).toBe(2); // Log 1 (40) and Log 2 (20) are before cutoff
    expect(result.deletedCount).toBe(2);
    
    const remaining = await prisma.internalApiUsageLog.count({ where: { userId } });
    expect(remaining).toBe(1); // Only recent (2 days) remains
  });

  it("should fail safely on invalid before date", async () => {
    await expect(cleanupUsageLogs({
      dryRun: false,
      before: new Date("invalid date")
    })).rejects.toThrow("Invalid 'before' date provided.");
  });

  it("should fail safely on invalid olderThanDays", async () => {
    await expect(cleanupUsageLogs({
      dryRun: false,
      olderThanDays: -5
    })).rejects.toThrow("Retention days must be a positive number.");
  });
});
