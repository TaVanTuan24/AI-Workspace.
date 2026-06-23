import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateWorkspaceQuotaThresholds } from "../workspaceQuotaAlertService.js";
import { prisma } from "../prisma.js";
import * as eventService from "../notificationEventService.js";
import * as prefService from "../notificationPreferenceService.js";
import * as quotaService from "../workspaceQuotaService.js";

vi.mock("../prisma.js", () => ({
  prisma: {
    workspaceMembership: {
      findMany: vi.fn()
    },
    notificationEvent: {
      count: vi.fn()
    }
  }
}));

vi.mock("../notificationEventService.js", () => ({
  materializeNotificationEvent: vi.fn()
}));

vi.mock("../notificationPreferenceService.js", () => ({
  getNotificationPreferences: vi.fn()
}));

vi.mock("../workspaceQuotaService.js", () => ({
  getWorkspaceUsageSummary: vi.fn()
}));

describe("WorkspaceQuotaAlertService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should evaluate thresholds and create no alerts if not exceeded", async () => {
    vi.mocked(quotaService.getWorkspaceUsageSummary).mockResolvedValue({
      plan: "local",
      quotas: [
        { resource: "members", limit: 10, used: 5, remaining: 5, exceeded: false }
      ]
    });
    vi.mocked(prisma.workspaceMembership.findMany).mockResolvedValue([
      { userId: "u1" } as any
    ]);
    vi.mocked(prefService.getNotificationPreferences).mockResolvedValue({
      notifyWorkspaceQuotaWarnings: true,
      notifyWorkspaceQuotaExceeded: true,
      workspaceQuotaWarningThresholdPercent: 90
    } as any);

    const counts = await evaluateWorkspaceQuotaThresholds({
      workspaceId: "ws-1",
      now: new Date()
    });

    expect(counts.warningsCreated).toBe(0);
    expect(counts.exceededCreated).toBe(0);
    expect(eventService.materializeNotificationEvent).not.toHaveBeenCalled();
  });

  it("should create warning alert when usage >= threshold", async () => {
    vi.mocked(quotaService.getWorkspaceUsageSummary).mockResolvedValue({
      plan: "local",
      quotas: [
        { resource: "members", limit: 10, used: 9, remaining: 1, exceeded: false }
      ]
    });
    vi.mocked(prisma.workspaceMembership.findMany).mockResolvedValue([
      { userId: "u1" } as any
    ]);
    vi.mocked(prefService.getNotificationPreferences).mockResolvedValue({
      notifyWorkspaceQuotaWarnings: true,
      notifyWorkspaceQuotaExceeded: true,
      workspaceQuotaWarningThresholdPercent: 90
    } as any);
    vi.mocked(prisma.notificationEvent.count).mockResolvedValue(0);

    const counts = await evaluateWorkspaceQuotaThresholds({
      workspaceId: "ws-1",
      now: new Date()
    });

    expect(counts.warningsCreated).toBe(1);
    expect(counts.exceededCreated).toBe(0);
    expect(eventService.materializeNotificationEvent).toHaveBeenCalledTimes(1);
  });

  it("should create exceeded alert when usage > limit", async () => {
    vi.mocked(quotaService.getWorkspaceUsageSummary).mockResolvedValue({
      plan: "local",
      quotas: [
        { resource: "members", limit: 10, used: 11, remaining: 0, exceeded: true }
      ]
    });
    vi.mocked(prisma.workspaceMembership.findMany).mockResolvedValue([
      { userId: "u1" } as any
    ]);
    vi.mocked(prefService.getNotificationPreferences).mockResolvedValue({
      notifyWorkspaceQuotaWarnings: true,
      notifyWorkspaceQuotaExceeded: true,
      workspaceQuotaWarningThresholdPercent: 90
    } as any);
    vi.mocked(prisma.notificationEvent.count).mockResolvedValue(0);

    const counts = await evaluateWorkspaceQuotaThresholds({
      workspaceId: "ws-1",
      now: new Date()
    });

    expect(counts.warningsCreated).toBe(0);
    expect(counts.exceededCreated).toBe(1);
    expect(eventService.materializeNotificationEvent).toHaveBeenCalledTimes(1);
  });

  it("should dedupe events using fingerprint", async () => {
    vi.mocked(quotaService.getWorkspaceUsageSummary).mockResolvedValue({
      plan: "local",
      quotas: [
        { resource: "members", limit: 10, used: 9, remaining: 1, exceeded: false }
      ]
    });
    vi.mocked(prisma.workspaceMembership.findMany).mockResolvedValue([
      { userId: "u1" } as any
    ]);
    vi.mocked(prefService.getNotificationPreferences).mockResolvedValue({
      notifyWorkspaceQuotaWarnings: true,
      notifyWorkspaceQuotaExceeded: true,
      workspaceQuotaWarningThresholdPercent: 90
    } as any);
    vi.mocked(prisma.notificationEvent.count).mockResolvedValue(1); // Already exists!

    const counts = await evaluateWorkspaceQuotaThresholds({
      workspaceId: "ws-1",
      now: new Date()
    });

    // We expect it to still call materializeNotificationEvent (which handles existing ones)
    // but warningsCreated should be 0 because it's already recorded.
    expect(counts.warningsCreated).toBe(0);
    expect(eventService.materializeNotificationEvent).toHaveBeenCalledTimes(1);
  });
});
