import { describe, it, expect, vi, beforeEach } from "vitest";
import { workspaceQuotaAlertScheduler } from "../workspaceQuotaAlertScheduler.js";
import { env } from "../../config/env.js";
import { prisma } from "../prisma.js";
import { chatQueueConnection } from "../chatQueue.js";
import * as alertService from "../workspaceQuotaAlertService.js";

vi.mock("../../config/env.js", () => ({
  env: {
    WORKSPACE_QUOTA_ALERT_SCHEDULER_ENABLED: true,
    WORKSPACE_QUOTA_ALERT_INTERVAL_SECONDS: 3600,
    WORKSPACE_QUOTA_ALERT_LOCK_TTL_SECONDS: 600,
    WORKSPACE_QUOTA_ALERT_MAX_WORKSPACES_PER_RUN: 500,
    NODE_ENV: "test"
  }
}));

vi.mock("../prisma.js", () => ({
  prisma: {
    workspace: {
      findMany: vi.fn()
    }
  }
}));

vi.mock("../chatQueue.js", () => ({
  chatQueueConnection: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn()
  }
}));

vi.mock("../schedulerStatusService.js", () => ({
  recordSchedulerSkipped: vi.fn(),
  recordSchedulerStarted: vi.fn(),
  recordSchedulerFailed: vi.fn(),
  recordSchedulerFinished: vi.fn(),
  WORKSPACE_INVITE_EXPIRY_SCHEDULER_NAME: "workspace_invites_expiry",
  WORKSPACE_QUOTA_ALERT_SCHEDULER_NAME: "workspace_quota_alerts"
}));

vi.mock("../workspaceQuotaAlertService.js", () => ({
  evaluateWorkspaceQuotaThresholds: vi.fn()
}));

describe("WorkspaceQuotaAlertScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should scan workspaces and evaluate thresholds", async () => {
    vi.mocked(chatQueueConnection.set).mockResolvedValue("OK");
    vi.mocked(prisma.workspace.findMany).mockResolvedValue([
      { id: "ws-1" } as any,
      { id: "ws-2" } as any
    ]);
    vi.mocked(alertService.evaluateWorkspaceQuotaThresholds)
      .mockResolvedValueOnce({ warningsCreated: 1, exceededCreated: 0 })
      .mockResolvedValueOnce({ warningsCreated: 0, exceededCreated: 1 });

    const result = await workspaceQuotaAlertScheduler.runOnce("manual");

    expect(result.scannedWorkspaces).toBe(2);
    expect(result.warningsCreated).toBe(1);
    expect(result.exceededCreated).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.lockAcquired).toBe(true);

    expect(alertService.evaluateWorkspaceQuotaThresholds).toHaveBeenCalledTimes(2);
    expect(alertService.evaluateWorkspaceQuotaThresholds).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1" })
    );
    expect(alertService.evaluateWorkspaceQuotaThresholds).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-2" })
    );
  });

  it("should skip if lock is held", async () => {
    vi.mocked(chatQueueConnection.set).mockResolvedValue(null);

    const result = await workspaceQuotaAlertScheduler.runOnce("manual");

    expect(result.skipped).toBe(1);
    expect(result.lockAcquired).toBe(false);
    expect(result.scannedWorkspaces).toBe(0);
    expect(prisma.workspace.findMany).not.toHaveBeenCalled();
  });

  it("should handle evaluation errors gracefully", async () => {
    vi.mocked(chatQueueConnection.set).mockResolvedValue("OK");
    vi.mocked(prisma.workspace.findMany).mockResolvedValue([
      { id: "ws-1" } as any
    ]);
    vi.mocked(alertService.evaluateWorkspaceQuotaThresholds).mockRejectedValue(new Error("DB error"));

    const result = await workspaceQuotaAlertScheduler.runOnce("manual");

    expect(result.errors).toBe(1);
    expect(result.scannedWorkspaces).toBe(1);
    expect(result.warningsCreated).toBe(0);
  });
});
