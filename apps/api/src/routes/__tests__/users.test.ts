import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userRoutes } from "../users.js";
import { prisma } from "../../services/prisma.js";
import { withTestUserScope } from "../../test/testIsolation.js";
import { ensureDefaultWorkspace } from "../../services/workspaceService.js";

const owner = withTestUserScope("route-users-owner");
const admin = withTestUserScope("route-users-admin");
const member = withTestUserScope("route-users-member");
const viewer = withTestUserScope("route-users-viewer");

let workspaceId: string;

async function buildApp() {
  const app = Fastify();
  app.decorateRequest("user", null);
  await app.register(userRoutes);
  return app;
}

async function createUser(scope: ReturnType<typeof withTestUserScope>, role: string) {
  const user = await prisma.user.create({
    data: {
      id: scope.userId,
      email: scope.email,
      displayName: scope.userId,
      workspaceId
    }
  });
  await prisma.workspaceMembership.create({
    data: {
      workspaceId,
      userId: user.id,
      role,
      status: "active"
    }
  });
}

describe("user routes", () => {
  beforeEach(async () => {
    for (const scope of [owner, admin, member, viewer]) {
      await scope.cleanup();
    }
    const ws = await prisma.workspace.create({
      data: { name: "Local Workspace", slug: `ws-route-users-${Date.now()}` }
    });
    workspaceId = ws.id;
    await createUser(owner, "owner");
    await createUser(admin, "admin");
    await createUser(member, "member");
    await createUser(viewer, "viewer");
  }, 30000);

  afterEach(async () => {
    for (const scope of [owner, admin, member, viewer]) {
      await scope.cleanup();
    }
    if (workspaceId) {
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
  }, 30000);

  it("allows owner and admin to list users safely", async () => {
    const app = await buildApp();
    const ownerResponse = await app.inject({
      method: "GET",
      url: "/settings/users",
      headers: { "x-local-user-id": owner.userId }
    });
    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.json().users[0]).not.toHaveProperty("passwordHash");
    expect(ownerResponse.body).not.toContain("encryptedSessionBlob");
    expect(ownerResponse.body).not.toContain("keyHash");

    const adminResponse = await app.inject({
      method: "GET",
      url: "/settings/users",
      headers: { "x-local-user-id": admin.userId }
    });
    expect(adminResponse.statusCode).toBe(200);
  });

  it("denies member and viewer user list access", async () => {
    const app = await buildApp();
    for (const scope of [member, viewer]) {
      const response = await app.inject({
        method: "GET",
        url: "/settings/users",
        headers: { "x-local-user-id": scope.userId }
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "permission_denied" });
    }
  });

  it("allows owner to update roles and denies non-owner role changes", async () => {
    const app = await buildApp();
    const ownerResponse = await app.inject({
      method: "PATCH",
      url: `/settings/users/${member.userId}/role`,
      headers: { "x-local-user-id": owner.userId },
      payload: { role: "admin" }
    });
    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.json().user.role).toBe("admin");

    const adminResponse = await app.inject({
      method: "PATCH",
      url: `/settings/users/${viewer.userId}/role`,
      headers: { "x-local-user-id": admin.userId },
      payload: { role: "member" }
    });
    expect(adminResponse.statusCode).toBe(403);
  });

  it("returns safe errors for invalid role and missing user", async () => {
    const app = await buildApp();
    const invalid = await app.inject({
      method: "PATCH",
      url: `/settings/users/${member.userId}/role`,
      headers: { "x-local-user-id": owner.userId },
      payload: { role: "superuser" }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "invalid_role" });

    const missing = await app.inject({
      method: "PATCH",
      url: "/settings/users/missing-user/role",
      headers: { "x-local-user-id": owner.userId },
      payload: { role: "viewer" }
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "user_not_found" });

  });

  it("returns safe role audit events", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: `/settings/users/${member.userId}/role`,
      headers: { "x-local-user-id": owner.userId },
      payload: { role: "viewer" }
    });

    const response = await app.inject({
      method: "GET",
      url: "/settings/workspace/audit",
      headers: { "x-local-user-id": owner.userId }
    });
    expect(response.statusCode).toBe(200);
    const event = response.json().events.find((e: any) => e.targetUserId === member.userId);
    expect(event).toMatchObject({
      actorUserId: owner.userId,
      targetUserId: member.userId,
      previousRole: "member",
      nextRole: "viewer"
    });
    expect(response.body).not.toContain(member.email);
  });

  it("should prevent a member from disabling a membership", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/settings/users/${admin.userId}/membership`,
      headers: { "x-local-user-id": member.userId },
      payload: { status: "disabled" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("should allow an owner to disable and enable a member's membership", async () => {
    const app = await buildApp();
    // Disable
    const disableRes = await app.inject({
      method: "PATCH",
      url: `/settings/users/${member.userId}/membership`,
      headers: { "x-local-user-id": owner.userId },
      payload: { status: "disabled" }
    });
    expect(disableRes.statusCode).toBe(200);

    const checkDisabled = await prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: member.userId } }
    });
    expect(checkDisabled?.status).toBe("disabled");

    // Enable
    const enableRes = await app.inject({
      method: "PATCH",
      url: `/settings/users/${member.userId}/membership`,
      headers: { "x-local-user-id": owner.userId },
      payload: { status: "active" }
    });
    expect(enableRes.statusCode).toBe(200);

    const checkEnabled = await prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: member.userId } }
    });
    expect(checkEnabled?.status).toBe("active");
  });
});
