import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import { workspaceQuotaRoutes } from "../workspaceQuota.js";
import { getWorkspaceUsageSummary, updateWorkspaceQuota, getWorkspaceQuotaEvents } from "../../services/workspaceQuotaService.js";

vi.mock("../../services/workspaceQuotaService.js", () => ({
  getWorkspaceUsageSummary: vi.fn(),
  updateWorkspaceQuota: vi.fn(),
  getWorkspaceQuotaEvents: vi.fn()
}));

vi.mock("../../auth/requirePermission.js", () => ({
  requirePermission: vi.fn().mockResolvedValue(true)
}));

vi.mock("../../auth/workspaceContext.js", () => ({
  getWorkspaceContextForRequest: vi.fn().mockResolvedValue({
    workspaceId: "test-workspace-123",
    userId: "user-1",
    role: "owner",
    permissions: ["settings.read", "settings.write"]
  })
}));

describe("workspaceQuotaRoutes", () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    
    // Mock user
    app.addHook("preHandler", async (request: any) => {
      request.user = { id: "user-1", workspaceId: "test-workspace-123", role: "owner" };
    });

    await app.register(workspaceQuotaRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /settings/workspace/quota returns summary", async () => {
    vi.mocked(getWorkspaceUsageSummary).mockResolvedValue({
      plan: "local",
      quotas: [
        {
          resource: "members",
          limit: 10,
          used: 2,
          remaining: 8,
          exceeded: false
        }
      ]
    } as any);

    const response = await app.inject({
      method: "GET",
      url: "/settings/workspace/quota"
    });

    if (response.statusCode === 500) {
      console.log("GET 500 ERROR:", response.payload);
    }
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.plan).toBe("local");
    const membersQuota = body.quotas.find((q: any) => q.resource === "members");
    expect(membersQuota.limit).toBe(10);
    expect(membersQuota.used).toBe(2);
    expect(membersQuota.remaining).toBe(8);
  });

  it("PATCH /settings/workspace/quota updates limits", async () => {
    vi.mocked(updateWorkspaceQuota).mockResolvedValue({
      workspaceId: "test-workspace-123",
      plan: "local",
      maxMembers: 50
    } as any);

    const response = await app.inject({
      method: "PATCH",
      url: "/settings/workspace/quota",
      payload: {
        maxMembers: 50
      }
    });

    if (response.statusCode === 500) {
      console.log("PATCH 500 ERROR:", response.payload);
    }
    expect(response.statusCode).toBe(200);
    expect(updateWorkspaceQuota).toHaveBeenCalledWith({
      workspaceId: "test-workspace-123",
      patch: {
        maxMembers: 50
      }
    });
  });

  it("GET /settings/workspace/quota/events returns events list", async () => {
    vi.mocked(getWorkspaceQuotaEvents).mockResolvedValue([
      {
        id: "evt-1",
        resource: "members",
        source: "workspace_invite_create",
        limit: 10,
        used: 10,
        attemptedIncrement: 1,
        createdAt: new Date()
      }
    ] as any);

    const response = await app.inject({
      method: "GET",
      url: "/settings/workspace/quota/events?resource=members&limit=5"
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].resource).toBe("members");
    expect(getWorkspaceQuotaEvents).toHaveBeenCalledWith({
      workspaceId: "test-workspace-123",
      resource: "members",
      limit: 5
    });
  });
});
