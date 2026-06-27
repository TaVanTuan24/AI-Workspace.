import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import { workspaceActivityRoutes } from "../workspaceActivity.js";
import { getWorkspaceActivityTimeline } from "../../services/workspaceActivityService.js";

vi.mock("../../services/workspaceActivityService.js", () => ({
  getWorkspaceActivityTimeline: vi.fn(),
  ACTIVITY_CATEGORIES: [
    "membership", "invite", "invite_delivery", "quota", "notification",
    "scheduler", "provider_health", "diagnostics", "recovery", "webhook", "api_usage"
  ],
}));

vi.mock("../../middleware/auth.js", () => ({
  attachLocalUser: async (request: any) => {
    request.user = { id: "user-1", workspaceId: "ws-activity-test", role: "owner" };
  }
}));

vi.mock("../../auth/requirePermission.js", () => ({
  requirePermission: vi.fn().mockResolvedValue(true)
}));

vi.mock("../../auth/workspaceContext.js", () => ({
  getWorkspaceContextForRequest: vi.fn().mockResolvedValue({
    workspaceId: "ws-activity-test",
    userId: "user-1",
    role: "owner",
    permissions: ["settings.read"]
  })
}));

describe("workspaceActivity route", () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addHook("preHandler", async (request: any) => {
      request.user = { id: "user-1", workspaceId: "ws-activity-test", role: "owner" };
    });
    await app.register(workspaceActivityRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /settings/workspace/activity returns events", async () => {
    vi.mocked(getWorkspaceActivityTimeline).mockResolvedValue({
      events: [
        {
          id: "membership-1",
          category: "membership",
          action: "role_changed",
          severity: "info",
          title: "Role change",
          summary: "Changed from member to admin",
          createdAt: new Date().toISOString(),
        }
      ],
      nextCursor: undefined,
    });

    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/activity?range=7d",
      headers: { "x-local-user-id": "user-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].category).toBe("membership");
  });

  it("rejects invalid range", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/activity?range=1y",
      headers: { "x-local-user-id": "user-1" },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe("invalid_range");
  });

  it("rejects invalid category", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/activity?category=hacking",
      headers: { "x-local-user-id": "user-1" },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe("invalid_category");
  });

  it("supports category filter", async () => {
    vi.mocked(getWorkspaceActivityTimeline).mockResolvedValue({ events: [], nextCursor: undefined });

    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/activity?category=quota&range=24h",
      headers: { "x-local-user-id": "user-1" },
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(getWorkspaceActivityTimeline)).toHaveBeenCalledWith(
      expect.objectContaining({
        range: "24h",
        filters: { categories: ["quota"] },
      })
    );
  });
});
