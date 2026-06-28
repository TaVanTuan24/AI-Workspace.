import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import { workspaceAdminExportRoutes } from "../workspaceAdminExport.js";
import { getWorkspaceAdminExport } from "../../services/workspaceAdminExportService.js";

vi.mock("../../services/workspaceAdminExportService.js", () => ({
  getWorkspaceAdminExport: vi.fn()
}));

vi.mock("../../middleware/auth.js", () => ({
  attachLocalUser: async (request: any) => {
    request.user = { id: "user-1", workspaceId: "ws-export-test", role: "owner" };
  }
}));

vi.mock("../../auth/requirePermission.js", () => ({
  requirePermission: vi.fn().mockResolvedValue(true)
}));

vi.mock("../../auth/workspaceContext.js", () => ({
  getWorkspaceContextForRequest: vi.fn().mockResolvedValue({
    workspaceId: "ws-export-test",
    userId: "user-1",
    role: "owner",
    permissions: ["settings.read"]
  })
}));

const mockExport = {
  exportedAt: new Date().toISOString(),
  range: "30d",
  workspace: { id: "ws-1", name: "Test WS", slug: "test-ws" },
  adminOverview: {
    workspace: { id: "ws-1", name: "Test WS", slug: "test-ws" },
    members: { active: 2, disabled: 0, pendingInvites: 0 },
    quotas: { exceeded: 0, nearLimit: 0 },
    schedulers: [],
    notifications: { unread: 0, criticalRecent: 0 },
    providers: { usable: 0, requiresAttention: 0 },
    emailDelivery: { enabled: false, provider: "noop", dryRun: true, realSendPossible: false },
    diagnostics: { openDriftAlerts: 0 },
  },
  schedulerFleetStatus: { schedulers: [] },
  activityTimeline: { events: [], totalReturned: 0 },
  quotaReport: null,
  inviteSummary: { total: 0, pending: 0, accepted: 0, revoked: 0, expired: 0 },
};

describe("workspaceAdminExport route", () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addHook("preHandler", async (request: any) => {
      request.user = { id: "user-1", workspaceId: "ws-export-test", role: "owner" };
    });
    await app.register(workspaceAdminExportRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /settings/workspace/admin-export returns export bundle", async () => {
    vi.mocked(getWorkspaceAdminExport).mockResolvedValue(mockExport);

    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/admin-export?range=30d",
      headers: { "x-local-user-id": "user-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.workspace.id).toBe("ws-1");
    expect(body.range).toBe("30d");
    // No secrets in export
    expect(res.payload).not.toContain("tokenHash");
    expect(res.payload).not.toContain("storageState");
    expect(res.payload).not.toContain("apiKey");
  });

  it("GET /settings/workspace/admin-export/download sets Content-Disposition", async () => {
    vi.mocked(getWorkspaceAdminExport).mockResolvedValue(mockExport);

    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/admin-export/download?range=7d",
      headers: { "x-local-user-id": "user-1" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("workspace-admin-export-test-ws-7d.json");
  });

  it("rejects invalid range", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/admin-export?range=1y",
      headers: { "x-local-user-id": "user-1" },
    });

    expect(res.statusCode).toBe(400);
  });
});
