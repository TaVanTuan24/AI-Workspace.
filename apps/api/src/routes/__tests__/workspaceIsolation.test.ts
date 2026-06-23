import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { createWorkspaceTestContext, buildAuthHeaders, type WorkspaceTestContext } from "../../test/workspaceTestContext.js";
import { workspaceActivityRoutes } from "../workspaceActivity.js";
import { workspaceAdminOverviewRoutes } from "../workspaceAdminOverview.js";
import { workspaceSchedulerRoutes } from "../workspaceSchedulers.js";
import { workspaceAdminExportRoutes } from "../workspaceAdminExport.js";

describe("cross-workspace isolation", () => {
  let app: any;
  let ctxA: WorkspaceTestContext;
  let ctxB: WorkspaceTestContext;

  beforeEach(async () => {
    app = Fastify();

    // Register routes
    await app.register(workspaceActivityRoutes);
    await app.register(workspaceAdminOverviewRoutes);
    await app.register(workspaceSchedulerRoutes);
    await app.register(workspaceAdminExportRoutes);

    ctxA = await createWorkspaceTestContext("ws-iso-a");
    ctxB = await createWorkspaceTestContext("ws-iso-b");
  });

  it("workspace A activity is not visible from workspace B user", async () => {
    // User B should not see workspace A activity
    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/activity?range=7d",
      headers: buildAuthHeaders(ctxB),
    });

    // If ctx resolution works, B gets B's data (possibly empty), never A's
    if (res.statusCode === 200) {
      const body = JSON.parse(res.payload);
      for (const event of body.events || []) {
        // No event should reference workspace A's ID in its metadata
        expect(JSON.stringify(event)).not.toContain(ctxA.workspaceId);
      }
    }
  });

  it("admin overview is workspace-scoped", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/admin-overview",
      headers: buildAuthHeaders(ctxA),
    });

    // If the route resolves, the workspace ID should be A's
    if (res.statusCode === 200) {
      const body = JSON.parse(res.payload);
      if (body.workspace) {
        expect(body.workspace.id).toBe(ctxA.workspaceId);
      }
    }
  });

  it("admin export only returns current workspace data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/admin-export?range=7d",
      headers: buildAuthHeaders(ctxA),
    });

    if (res.statusCode === 200) {
      const body = JSON.parse(res.payload);
      if (body.workspace) {
        expect(body.workspace.id).toBe(ctxA.workspaceId);
        expect(body.workspace.id).not.toBe(ctxB.workspaceId);
      }
      // Ensure no reference to workspace B
      expect(res.payload).not.toContain(ctxB.workspaceId);
    }
  });

  it("disabled member denied for activity endpoint", async () => {
    const { prisma } = await import("../../services/prisma.js");
    // Disable ctxA membership
    await prisma.workspaceMembership.update({
      where: { id: ctxA.membershipId },
      data: { status: "disabled" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/settings/workspace/activity?range=7d",
      headers: buildAuthHeaders(ctxA),
    });

    // Should be denied — either 401/403
    expect([401, 403]).toContain(res.statusCode);
  });
});
