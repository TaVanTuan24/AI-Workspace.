import { describe, it, expect, vi, beforeEach } from "vitest";
import { deleteOldNotificationEvents } from "../notificationEventService.js";
import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";

vi.mock("../prisma.js", () => ({
  prisma: {
    notificationEvent: {
      count: vi.fn(),
      deleteMany: vi.fn()
    }
  }
}));

describe("notificationEventService - deleteOldNotificationEvents", () => {
  const originalEnv = { ...env };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(env, originalEnv);
  });

  it("should use env.NOTIFICATION_EVENT_RETENTION_DAYS by default", async () => {
    env.NOTIFICATION_EVENT_RETENTION_DAYS = 90;
    
    vi.mocked(prisma.notificationEvent.count).mockResolvedValue(5);
    vi.mocked(prisma.notificationEvent.deleteMany).mockResolvedValue({ count: 5 });

    const result = await deleteOldNotificationEvents({ dryRun: false });

    expect(result.retentionDays).toBe(90);
    expect(result.matchedCount).toBe(5);
    expect(result.deletedCount).toBe(5);
    expect(prisma.notificationEvent.deleteMany).toHaveBeenCalledTimes(1);
    
    const callArgs = vi.mocked(prisma.notificationEvent.deleteMany).mock.calls[0][0];
    expect((callArgs?.where?.createdAt as any)?.lt).toBeInstanceOf(Date);
  });

  it("should support custom olderThanDays", async () => {
    vi.mocked(prisma.notificationEvent.count).mockResolvedValue(10);
    vi.mocked(prisma.notificationEvent.deleteMany).mockResolvedValue({ count: 10 });

    const result = await deleteOldNotificationEvents({ olderThanDays: 30, dryRun: false });

    expect(result.retentionDays).toBe(30);
    expect(result.matchedCount).toBe(10);
    expect(result.deletedCount).toBe(10);
  });

  it("should support custom before date", async () => {
    vi.mocked(prisma.notificationEvent.count).mockResolvedValue(2);
    vi.mocked(prisma.notificationEvent.deleteMany).mockResolvedValue({ count: 2 });

    const beforeDate = new Date("2020-01-01T00:00:00Z");
    const result = await deleteOldNotificationEvents({ before: beforeDate, dryRun: false });

    expect(result.cutoffDate).toBe(beforeDate.toISOString());
    expect(result.matchedCount).toBe(2);
    expect(result.deletedCount).toBe(2);
  });

  it("should not delete when dryRun is true", async () => {
    vi.mocked(prisma.notificationEvent.count).mockResolvedValue(7);
    vi.mocked(prisma.notificationEvent.deleteMany).mockResolvedValue({ count: 7 });

    const result = await deleteOldNotificationEvents({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.matchedCount).toBe(7);
    expect(result.deletedCount).toBe(0);
    expect(prisma.notificationEvent.deleteMany).not.toHaveBeenCalled();
  });

  it("should throw on invalid retention days", async () => {
    await expect(deleteOldNotificationEvents({ olderThanDays: -5 })).rejects.toThrow("positive number");
  });

  it("should throw on invalid before date", async () => {
    await expect(deleteOldNotificationEvents({ before: new Date("invalid") })).rejects.toThrow("Invalid 'before' date");
  });
});
