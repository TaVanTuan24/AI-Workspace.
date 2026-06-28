import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../apiUsageCleanupService.js", () => ({ cleanupUsageLogs: vi.fn() }));
vi.mock("../notificationEventService.js", () => ({ deleteOldNotificationEvents: vi.fn() }));

import { cleanupUsageLogs } from "../apiUsageCleanupService.js";
import { deleteOldNotificationEvents } from "../notificationEventService.js";
import { runRetentionCleanup } from "../retentionCleanupService.js";

describe("runRetentionCleanup", () => {
  afterEach(() => vi.clearAllMocks());

  it("composes usage + notification cleanups and aggregates counts", async () => {
    vi.mocked(cleanupUsageLogs).mockResolvedValue({
      dryRun: false,
      cutoffDate: "2026-01-01T00:00:00.000Z",
      matchedCount: 7,
      deletedCount: 7
    } as any);
    vi.mocked(deleteOldNotificationEvents).mockResolvedValue({
      dryRun: false,
      cutoffDate: "2026-01-01T00:00:00.000Z",
      matchedCount: 3,
      deletedCount: 3
    } as any);

    const result = await runRetentionCleanup({ dryRun: false }, new Date("2026-06-28T00:00:00.000Z"));

    expect(result.usage).toEqual({ matched: 7, deleted: 7 });
    expect(result.notifications).toEqual({ matched: 3, deleted: 3 });
    expect(result.dryRun).toBe(false);
    expect(cleanupUsageLogs).toHaveBeenCalledWith({ dryRun: false });
    expect(deleteOldNotificationEvents).toHaveBeenCalledWith({ dryRun: false });
  });

  it("passes dryRun through to both cleanups (nothing deleted)", async () => {
    vi.mocked(cleanupUsageLogs).mockResolvedValue({
      dryRun: true,
      cutoffDate: "2026-01-01T00:00:00.000Z",
      matchedCount: 5,
      deletedCount: 0
    } as any);
    vi.mocked(deleteOldNotificationEvents).mockResolvedValue({
      dryRun: true,
      cutoffDate: "2026-01-01T00:00:00.000Z",
      matchedCount: 2,
      deletedCount: 0
    } as any);

    const result = await runRetentionCleanup({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.usage).toEqual({ matched: 5, deleted: 0 });
    expect(result.notifications).toEqual({ matched: 2, deleted: 0 });
    expect(cleanupUsageLogs).toHaveBeenCalledWith({ dryRun: true });
    expect(deleteOldNotificationEvents).toHaveBeenCalledWith({ dryRun: true });
  });
});
