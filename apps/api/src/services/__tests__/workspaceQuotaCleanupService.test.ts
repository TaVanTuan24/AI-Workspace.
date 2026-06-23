import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { cleanupWorkspaceQuotaEvents } from "../workspaceQuotaCleanupService.js";
import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";

vi.mock("../prisma.js", () => ({
  prisma: {
    workspaceQuotaEvent: {
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn()
    }
  }
}));

describe("workspaceQuotaCleanupService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should safely dry run deleting events older than cutoff date", async () => {
    vi.mocked(prisma.workspaceQuotaEvent.count).mockResolvedValue(42);

    const result = await cleanupWorkspaceQuotaEvents({
      retentionDays: 30,
      dryRun: true
    });

    expect(result.scanned).toBe(42);
    expect(result.deleted).toBe(42); // dryRun simulates deleted = scanned
    expect(result.dryRun).toBe(true);
    expect(prisma.workspaceQuotaEvent.deleteMany).not.toHaveBeenCalled();
  });

  it("should safely batch delete events older than cutoff date", async () => {
    vi.mocked(prisma.workspaceQuotaEvent.count).mockResolvedValue(5);
    
    // First batch returns 2 events
    vi.mocked(prisma.workspaceQuotaEvent.findMany)
      .mockResolvedValueOnce([{ id: "e1" }, { id: "e2" }] as any)
      // Second batch returns 0
      .mockResolvedValueOnce([]);

    vi.mocked(prisma.workspaceQuotaEvent.deleteMany).mockResolvedValue({ count: 2 });

    const result = await cleanupWorkspaceQuotaEvents({
      retentionDays: 30,
      batchSize: 2,
      dryRun: false
    });

    expect(result.scanned).toBe(5);
    expect(result.deleted).toBe(2);
    expect(result.dryRun).toBe(false);
    expect(prisma.workspaceQuotaEvent.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.workspaceQuotaEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["e1", "e2"] }
      }
    });
  });
});
