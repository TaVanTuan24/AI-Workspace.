import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { applyWorkspaceQuotaPreset } from "../workspaceQuotaPresetService.js";
import { getWorkspaceUsageSummary } from "../workspaceQuotaService.js";
import { recordUserRoleAuditEvent } from "../userManagementService.js";
import { prisma } from "../prisma.js";

vi.mock("../prisma.js", () => ({
  prisma: {
    workspaceMembership: {
      findUnique: vi.fn(),
    },
    workspaceQuota: {
      upsert: vi.fn(),
    }
  }
}));

vi.mock("../workspaceQuotaService.js", () => ({
  getWorkspaceUsageSummary: vi.fn()
}));

vi.mock("../userManagementService.js", () => ({
  recordUserRoleAuditEvent: vi.fn()
}));

describe("workspaceQuotaPresetService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should apply a preset successfully if user is owner and no limits exceeded", async () => {
    vi.mocked(prisma.workspaceMembership.findUnique).mockResolvedValue({ role: "owner" } as any);
    
    vi.mocked(getWorkspaceUsageSummary).mockResolvedValue({
      plan: "local",
      quotas: [
        { resource: "members", limit: null, used: 2, remaining: null, exceeded: false },
        { resource: "pendingInvites", limit: null, used: 0, remaining: null, exceeded: false },
      ]
    });

    const result = await applyWorkspaceQuotaPreset({
      actorUserId: "u1",
      workspaceId: "ws1",
      presetId: "starter" // maxMembers: 3
    });

    expect(result.success).toBe(true);
    expect(prisma.workspaceQuota.upsert).toHaveBeenCalled();
    expect(recordUserRoleAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "apply_quota_preset",
      nextStatus: "starter"
    }));
  });

  it("should warn if preset would exceed current usage without confirmation", async () => {
    vi.mocked(prisma.workspaceMembership.findUnique).mockResolvedValue({ role: "owner" } as any);
    
    vi.mocked(getWorkspaceUsageSummary).mockResolvedValue({
      plan: "local",
      quotas: [
        { resource: "members", limit: null, used: 5, remaining: null, exceeded: false },
      ]
    });

    // starter maxMembers is 3, used is 5
    const result = await applyWorkspaceQuotaPreset({
      actorUserId: "u1",
      workspaceId: "ws1",
      presetId: "starter"
    });

    expect(result.success).toBe(false);
    expect(result.warning).toBe("quota_preset_would_exceed_usage");
    expect(result.exceededResources).toBeDefined();
    expect(prisma.workspaceQuota.upsert).not.toHaveBeenCalled();
  });

  it("should apply if preset would exceed current usage but confirmation is provided", async () => {
    vi.mocked(prisma.workspaceMembership.findUnique).mockResolvedValue({ role: "owner" } as any);
    
    vi.mocked(getWorkspaceUsageSummary).mockResolvedValue({
      plan: "local",
      quotas: [
        { resource: "members", limit: null, used: 5, remaining: null, exceeded: false },
      ]
    });

    const result = await applyWorkspaceQuotaPreset({
      actorUserId: "u1",
      workspaceId: "ws1",
      presetId: "starter",
      confirmExceeded: true
    });

    expect(result.success).toBe(true);
    expect(prisma.workspaceQuota.upsert).toHaveBeenCalled();
  });

  it("should fail if actor is not an owner", async () => {
    vi.mocked(prisma.workspaceMembership.findUnique).mockResolvedValue({ role: "admin" } as any);

    await expect(applyWorkspaceQuotaPreset({
      actorUserId: "u1",
      workspaceId: "ws1",
      presetId: "starter"
    })).rejects.toThrow("Permission denied: only workspace owners can apply quota presets");
  });

  it("should fail if preset does not exist", async () => {
    await expect(applyWorkspaceQuotaPreset({
      actorUserId: "u1",
      workspaceId: "ws1",
      presetId: "nonexistent"
    })).rejects.toThrow("Invalid preset ID");
  });
});
