import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import { workspaceAdminOverviewRoutes } from "../workspaceAdminOverview.js";
import { getWorkspaceAdminOverview } from "../../services/workspaceAdminOverviewService.js";

vi.mock("../../services/workspaceAdminOverviewService.js", () => ({
  getWorkspaceAdminOverview: vi.fn()
}));

vi.mock("../../middleware/auth.js", () => ({
  attachLocalUser: async (request: any) => {
    request.user = { id: "user-1", workspaceId: "ws-overview-test", role: "owner" };
  }
}));

vi.mock("../../auth/requirePermission.js", () => ({
  requirePermission: vi.fn().mockResolvedValue(true)
}));

vi.mock("../../auth/workspaceContext.js", () => ({
  getWorkspaceContextForRequest: vi.fn().mockResolvedValue({
    workspaceId: "ws-overview-test",
    userId: "user-1",
    role: "owner",
    permissions: ["settings.read"]
  })
}));

describe("workspaceAdminOverview route", () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addHook("preHandler", async (request: any) => {
      request.user = { id: "user-1", workspaceId: "ws-overview-test", role: "owner" };
    });
    await app.register(workspaceAdminOverviewRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /settings/workspace/admin-overview returns safe overview", async () => {
    vi.mocked(getWorkspaceAdminOverview).mockResolvedValue({
      workspace: { id: "ws-1", name: "Test", slug: "test" },
      members: { active: 3, disabled: 1, pendingInvites: 2 },
      quotas: { exceeded: 0, nearLimit: 1 },
      schedulers: [{ name: "provider_health", enabled: true, lastStatus: "success" }],
      notifications: { unread: 5, criticalRecent: 0 },
      providers: { usable: 2, requiresAttention: 1 },
      emailDelivery: { enabled: true, provider: "noop", dryRun: true, realSendPossible: false },
      diagnostics: { openDriftAlerts: 0 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/admin-overview",
      headers: { "x-local-user-id": "user-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.workspace.id).toBe("ws-1");
    expect(body.members.active).toBe(3);
    expect(body.quotas.exceeded).toBe(0);
    expect(body.schedulers).toHaveLength(1);
    // Ensure no secrets
    expect(res.payload).not.toContain("tokenHash");
    expect(res.payload).not.toContain("storageState");
    expect(res.payload).not.toContain("apiKey");
  });
});
