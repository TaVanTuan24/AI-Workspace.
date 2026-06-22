import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { requirePermission } from "./requirePermission.js";

const state = vi.hoisted(() => ({
  auditCreate: vi.fn()
}));

vi.mock("../services/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn()
    },
    auditLog: {
      create: state.auditCreate
    }
  }
}));

vi.mock("./workspaceContext.js", () => ({
  getWorkspaceContextForRequest: vi.fn(async (request: any) => {
    if (!request.user) return null;
    return {
      userId: request.user.id,
      workspaceId: request.user.workspaceId || "test-workspace-id",
      membershipId: "test-membership-id",
      role: request.user.role || "viewer",
      permissions: []
    };
  })
}));

describe("requirePermission", () => {
  it("allows owner/admin roles", async () => {
    const app = Fastify();
    app.get("/secure", async (request, reply) => {
      request.user = { id: "owner_1", email: "owner@example.com", role: "owner" };
      if (!(await requirePermission(request, reply, "apiKeys.write"))) return;
      return reply.send({ ok: true });
    });

    const response = await app.inject({ method: "GET", url: "/secure" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("returns a safe 403 and safe audit metadata for denied users", async () => {
    state.auditCreate.mockClear();
    const app = Fastify();
    app.get("/secure", async (request, reply) => {
      request.user = { id: "viewer_1", email: "viewer@example.com", role: "viewer" };
      if (!(await requirePermission(request, reply, "apiKeys.write"))) return;
      return reply.send({ ok: true });
    });

    const response = await app.inject({ method: "GET", url: "/secure?token=secret" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "permission_denied" });
    expect(response.body).not.toContain("secret");
    expect(state.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "viewer_1",
        action: "permission.denied",
        result: "denied",
        metadataSafeJson: JSON.stringify({ permission: "apiKeys.write", route: "/secure" })
      })
    });
  });
});
