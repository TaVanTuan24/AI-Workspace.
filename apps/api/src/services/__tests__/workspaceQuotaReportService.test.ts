import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getWorkspaceQuotaReport } from "../workspaceQuotaReportService.js";
import { prisma } from "../prisma.js";

vi.mock("../prisma.js", () => ({
  prisma: {
    workspace: {
      findUnique: vi.fn(),
    },
    workspaceQuotaEvent: {
      findMany: vi.fn(),
    },
    workspaceQuota: {
      findUnique: vi.fn(),
    },
    workspaceMembership: { count: vi.fn() },
    workspaceInvite: { count: vi.fn() },
    internalApiKey: { count: vi.fn() },
    providerConnection: { count: vi.fn() },
    notificationWebhookDestination: { count: vi.fn() },
    providerRecoveryPolicy: { count: vi.fn() },
    providerDiagnosticsBaseline: { count: vi.fn() },
    $transaction: vi.fn(),
  }
}));

vi.mock("../workspaceQuotaService.js", () => ({
  getWorkspaceUsageSummary: vi.fn()
}));

describe("workspaceQuotaReportService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should generate a report with aggregated events", async () => {
    const mockWorkspace = { id: "ws1", name: "Workspace 1", slug: "ws-1" };
    const mockEvents = [
      { id: "e1", resource: "members", source: "api", limit: 5, used: 4, attemptedIncrement: 1, createdAt: new Date() },
      { id: "e2", resource: "members", source: "api", limit: 5, used: 4, attemptedIncrement: 1, createdAt: new Date() },
      { id: "e3", resource: "invites", source: "dashboard", limit: 10, used: 10, attemptedIncrement: 1, createdAt: new Date() }
    ];

    vi.mocked(prisma.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
    vi.mocked(prisma.workspaceQuota.findUnique).mockResolvedValue({
      workspaceId: "ws1",
      plan: "local",
      maxMembers: 5,
      maxInvites: 10,
      maxApiKeys: null,
      maxProviderConnections: null,
      maxWebhookDestinations: null,
      maxRecoveryPolicies: null,
      maxDiagnosticsBaselines: null,
      maxMonthlyApiRequests: null,
      maxMonthlyInviteEmails: null
    } as any);

    const { getWorkspaceUsageSummary } = await import("../workspaceQuotaService.js");
    vi.mocked(getWorkspaceUsageSummary).mockResolvedValue({
      plan: "local",
      quotas: [
        { resource: "members", limit: 5, used: 4, remaining: 1, exceeded: false },
        { resource: "pendingInvites", limit: 10, used: 10, remaining: 0, exceeded: true }
      ]
    });

    vi.mocked(prisma.workspaceQuotaEvent.findMany).mockResolvedValue(mockEvents as any);

    const report = await getWorkspaceQuotaReport({
      actorUserId: "u1",
      workspaceId: "ws1",
      range: "7d"
    });

    expect(report.workspace.id).toBe("ws1");
    expect(report.eventsByResource).toContainEqual({ resource: "members", count: 2 });
    expect(report.eventsByResource).toContainEqual({ resource: "invites", count: 1 });
    expect(report.eventsBySource).toContainEqual({ source: "api", count: 2 });
    expect(report.recentEvents.length).toBe(3);
    expect(report.quotas.find(q => q.resource === "members")?.limit).toBe(5);
  });

  it("should fail if workspace is not found", async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);

    await expect(getWorkspaceQuotaReport({
      actorUserId: "u1",
      workspaceId: "ws1",
      range: "7d"
    })).rejects.toThrow("Workspace not found");
  });
});
