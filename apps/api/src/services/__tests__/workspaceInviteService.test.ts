import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../prisma.js";
import {
  createWorkspaceInvite,
  listWorkspaceInvites,
  revokeWorkspaceInvite,
  acceptWorkspaceInvite,
  expireInvites,
  WorkspaceInviteError
} from "../workspaceInviteService.js";
import { createWorkspaceTestContext, type WorkspaceTestContext } from "../../test/workspaceTestContext.js";
import { cleanupTestUserData } from "../../test/testIsolation.js";

describe("WorkspaceInviteService", () => {
  let ctx: WorkspaceTestContext;

  beforeEach(async () => {
    ctx = await createWorkspaceTestContext("ws-invite");
  });

  afterEach(async () => {
    if (ctx) await cleanupTestUserData(ctx.userId);
  });

  it("should create an invite and list it", async () => {
    const { invite, rawToken } = await createWorkspaceInvite({
      workspaceId: ctx.workspaceId,
      email: "invitee@example.com",
      role: "member",
      actorUserId: ctx.userId
    });

    expect(invite.email).toBe("invitee@example.com");
    expect(invite.status).toBe("pending");
    expect(rawToken).toBeDefined();

    const list = await listWorkspaceInvites({ workspaceId: ctx.workspaceId });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(invite.id);
  });

  it("should fail if invite already exists", async () => {
    await createWorkspaceInvite({ workspaceId: ctx.workspaceId, email: "invitee@example.com", role: "member", actorUserId: ctx.userId });

    await expect(
      createWorkspaceInvite({ workspaceId: ctx.workspaceId, email: "invitee@example.com", role: "member", actorUserId: ctx.userId })
    ).rejects.toThrowError(new WorkspaceInviteError("already_invited"));
  });

  it("should revoke an invite", async () => {
    const { invite } = await createWorkspaceInvite({ workspaceId: ctx.workspaceId, email: "invitee@example.com", role: "member", actorUserId: ctx.userId });

    const revoked = await revokeWorkspaceInvite({ workspaceId: ctx.workspaceId, inviteId: invite.id });
    expect(revoked.status).toBe("revoked");

    const list = await listWorkspaceInvites({ workspaceId: ctx.workspaceId });
    expect(list[0].status).toBe("revoked");
  });

  it("should accept an invite", async () => {
    // Create target user directly (simulate login)
    const inviteeCtx = await createWorkspaceTestContext("ws-invitee");

    const { invite, rawToken } = await createWorkspaceInvite({ workspaceId: ctx.workspaceId, email: inviteeCtx.email, role: "member", actorUserId: ctx.userId });

    // Create target user directly (simulate login)
    const result = await acceptWorkspaceInvite({ token: rawToken, userId: inviteeCtx.userId });
    expect(result.workspaceId).toBe(ctx.workspaceId);

    const updatedInvite = await prisma.workspaceInvite.findUnique({ where: { id: invite.id } });
    expect(updatedInvite?.status).toBe("accepted");

    const membership = await prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: inviteeCtx.userId } }
    });
    expect(membership?.role).toBe("member");
    expect(membership?.status).toBe("active");

    await cleanupTestUserData(inviteeCtx.userId);
  });

  it("should expire invites", async () => {
    const { invite } = await createWorkspaceInvite({ workspaceId: ctx.workspaceId, email: "expire_test@example.com", role: "member", actorUserId: ctx.userId });
    
    // Default expiration is 7 days in future.
    // So if we run `expireInvites` with `now` being 8 days later, it should expire it.
    const futureDate = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

    const dryRes = await expireInvites({ now: futureDate, dryRun: true });
    expect(dryRes.scanned).toBeGreaterThanOrEqual(1);
    expect(dryRes.expired).toBeGreaterThanOrEqual(1);

    const res = await expireInvites({ now: futureDate });
    expect(res.scanned).toBeGreaterThanOrEqual(1);
    expect(res.expired).toBeGreaterThanOrEqual(1);

    const updatedInvite = await prisma.workspaceInvite.findUnique({ where: { id: invite.id } });
    expect(updatedInvite?.status).toBe("expired");
  });
});
