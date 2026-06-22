import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { workspaceInviteRoutes } from "../workspaceInvites.js";
import { createWorkspaceTestContext, type WorkspaceTestContext, buildAuthHeaders } from "../../test/workspaceTestContext.js";
import { cleanupTestUserData } from "../../test/testIsolation.js";
import { prisma } from "../../services/prisma.js";

describe("workspaceInvite routes", () => {
  let app: FastifyInstance;
  let ctx: WorkspaceTestContext;

  beforeAll(async () => {
    app = Fastify();
    await app.register(workspaceInviteRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    ctx = await createWorkspaceTestContext("ws-invites-rt");
  });

  afterEach(async () => {
    if (ctx) await cleanupTestUserData(ctx.userId);
  });

  it("should create an invite and list it for owner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/settings/workspace/invites",
      headers: buildAuthHeaders(ctx),
      payload: {
        email: "route-test@example.com",
        role: "member"
      }
    });

    if (res.statusCode !== 200) console.log(res.json());
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.invite).toBeDefined();
    expect(body.invite.email).toBe("route-test@example.com");
    expect(body.token).toBeDefined();
    expect(body.emailPreview).toBeDefined();
    expect(body.emailPreview.subject).toContain("ws-invites-rt");
    expect(body.delivery).toBeDefined();

    const listRes = await app.inject({
      method: "GET",
      url: "/settings/workspace/invites",
      headers: buildAuthHeaders(ctx)
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    expect(listBody.invites).toHaveLength(1);
    expect(listBody.invites[0].email).toBe("route-test@example.com");
    // Ensure rawToken is NOT in list
    expect(listBody.invites[0].token).toBeUndefined();
    expect(listBody.invites[0].tokenHash).toBeUndefined();
    expect(listBody.invites[0].latestDelivery).toBeDefined();
  });

  it("should preview an invite", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/settings/workspace/invites/preview",
      headers: buildAuthHeaders(ctx),
      payload: {
        email: "preview-test@example.com",
        role: "admin",
        expiresInDays: 3
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.emailPreview).toBeDefined();
    expect(body.emailPreview.subject).toContain("ws-invites-rt");
    expect(body.emailPreview.text).toContain("as a admin");
  });

  it("should prevent non-owners from creating invites", async () => {
    // Create member user
    const memberCtx = await createWorkspaceTestContext("ws-invites-member");
    
    // Switch to the same workspace but as a member
    await prisma.workspaceMembership.create({
      data: {
        workspaceId: ctx.workspaceId,
        userId: memberCtx.userId,
        role: "member",
        status: "active"
      }
    });
    await prisma.user.update({
      where: { id: memberCtx.userId },
      data: { workspaceId: ctx.workspaceId }
    });

    // Make member request in ctx workspace
    const res = await app.inject({
      method: "POST",
      url: "/settings/workspace/invites",
      headers: {
        ...buildAuthHeaders(memberCtx),
        "x-workspace-id": ctx.workspaceId
      },
      payload: {
        email: "member-trying-to-invite@example.com",
        role: "member"
      }
    });

    // Expect 403 Forbidden since users.manageRoles is required
    expect(res.statusCode).toBe(403);
    
    await cleanupTestUserData(memberCtx.userId);
  });

  it("should revoke an invite", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/settings/workspace/invites",
      headers: buildAuthHeaders(ctx),
      payload: { email: "revoke-test@example.com", role: "member" }
    });
    const inviteId = createRes.json().invite.id;

    const res = await app.inject({
      method: "POST",
      url: `/settings/workspace/invites/${inviteId}/revoke`,
      headers: buildAuthHeaders(ctx)
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().invite.status).toBe("revoked");
  });

  it("should accept an invite", async () => {
    const inviteeCtx = await createWorkspaceTestContext("ws-invites-accept");
    
    const createRes = await app.inject({
      method: "POST",
      url: "/settings/workspace/invites",
      headers: buildAuthHeaders(ctx),
      payload: { email: inviteeCtx.email, role: "viewer" }
    });
    const { token } = createRes.json();

    const res = await app.inject({
      method: "POST",
      url: "/workspace/invites/accept",
      headers: buildAuthHeaders(inviteeCtx),
      payload: { token }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().workspaceId).toBe(ctx.workspaceId);

    // Verify membership
    const membership = await prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: inviteeCtx.userId } }
    });
    expect(membership).toBeDefined();
    expect(membership?.role).toBe("viewer");
    expect(membership?.status).toBe("active");

    await cleanupTestUserData(inviteeCtx.userId);
  });
});
