import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import { workspaceSchedulerRoutes } from "../workspaceSchedulers.js";
import { getSchedulerFleetStatus } from "../../services/schedulerFleetStatusService.js";

vi.mock("../../services/schedulerFleetStatusService.js", () => ({
  getSchedulerFleetStatus: vi.fn()
}));

vi.mock("../../auth/requirePermission.js", () => ({
  requirePermission: vi.fn().mockResolvedValue(true)
}));

vi.mock("../../auth/workspaceContext.js", () => ({
  getWorkspaceContextForRequest: vi.fn().mockResolvedValue({
    workspaceId: "ws-sched-test",
    userId: "user-1",
    role: "owner",
    permissions: ["settings.read"]
  })
}));

describe("workspaceSchedulers route", () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addHook("preHandler", async (request: any) => {
      request.user = { id: "user-1", workspaceId: "ws-sched-test", role: "owner" };
    });
    await app.register(workspaceSchedulerRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /settings/workspace/schedulers returns fleet status", async () => {
    vi.mocked(getSchedulerFleetStatus).mockResolvedValue({
      schedulers: [
        {
          name: "provider_health",
          enabled: true,
          lastStatus: "success",
          lastStartedAt: new Date().toISOString(),
          lastFinishedAt: new Date().toISOString(),
          runCount: 10,
          failureCount: 0,
          skippedCount: 2,
        },
        {
          name: "workspace_invite_expiry",
          enabled: false,
          runCount: 0,
          failureCount: 0,
          skippedCount: 0,
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/schedulers",
      headers: { "x-local-user-id": "user-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.schedulers).toHaveLength(2);
    expect(body.schedulers[0].name).toBe("provider_health");
    expect(body.schedulers[0].runCount).toBe(10);
  });
});
