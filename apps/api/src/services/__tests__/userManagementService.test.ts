import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../prisma.js";
import { withTestUserScope } from "../../test/testIsolation.js";
import { ensureDefaultWorkspace } from "../workspaceService.js";
import {
  listWorkspaceAuditEvents,
  listUsers,
  updateUserRole
} from "../userManagementService.js";

const owner = withTestUserScope("role-owner");
const otherOwner = withTestUserScope("role-other-owner");
const admin = withTestUserScope("role-admin");
const member = withTestUserScope("role-member");

let workspaceId: string;

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
  return user;
}

describe("userManagementService", () => {
  beforeEach(async () => {
    for (const scope of [owner, otherOwner, admin, member]) {
      await scope.cleanup();
    }
    const ws = await prisma.workspace.create({
      data: { name: "Local Workspace", slug: `ws-um-svc-${Date.now()}` }
    });
    workspaceId = ws.id;
    await createUser(owner, "owner");
    await createUser(admin, "admin");
    await createUser(member, "member");
  }, 30000);

  afterEach(async () => {
    for (const scope of [owner, otherOwner, admin, member]) {
      await scope.cleanup();
    }
    if (workspaceId) {
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
  }, 30000);

  it("lists users with safe fields only", async () => {
    const users = await listUsers({ workspaceId });
    const row = users.find((user) => user.id === member.userId);
    expect(row).toMatchObject({
      id: member.userId,
      email: member.email,
      name: member.userId,
      role: "member"
    });
    expect(JSON.stringify(row)).not.toContain("passwordHash");
    expect(JSON.stringify(row)).not.toContain("encryptedSessionBlob");
    expect(JSON.stringify(row)).not.toContain("keyHash");
  });

  it("lets owner promote member to admin and records safe audit", async () => {
    const updated = await updateUserRole({
      workspaceId,
      actorUserId: owner.userId,
      targetUserId: member.userId,
      role: "admin"
    });
    expect(updated.role).toBe("admin");

    const events = await listWorkspaceAuditEvents({ workspaceId });
    expect(events[0]).toMatchObject({
      actorUserId: owner.userId,
      targetUserId: member.userId,
      previousRole: "member",
      nextRole: "admin",
      action: "user.role.changed"
    });
    expect(JSON.stringify(events[0])).not.toContain(member.email);
  });

  it("lets owner promote admin to owner", async () => {
    const updated = await updateUserRole({
      workspaceId,
      actorUserId: owner.userId,
      targetUserId: admin.userId,
      role: "owner"
    });
    expect(updated.role).toBe("owner");
  });

  it("does not create duplicate audit events for no-op role updates", async () => {
    await updateUserRole({
      workspaceId,
      actorUserId: owner.userId,
      targetUserId: member.userId,
      role: "member"
    });
    const events = await listWorkspaceAuditEvents({ workspaceId });
    const relevant = events.filter(e => e.actorUserId === owner.userId && e.targetUserId === member.userId);
    expect(relevant).toHaveLength(0);
  });

  it("blocks admin role changes", async () => {
    await expect(updateUserRole({
      workspaceId,
      actorUserId: admin.userId,
      targetUserId: member.userId,
      role: "viewer"
    })).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("rejects invalid role and missing target", async () => {
    await expect(updateUserRole({
      workspaceId,
      actorUserId: owner.userId,
      targetUserId: member.userId,
      role: "superuser"
    })).rejects.toMatchObject({ code: "invalid_role" });

    await expect(updateUserRole({
      workspaceId,
      actorUserId: owner.userId,
      targetUserId: "missing-user",
      role: "viewer"
    })).rejects.toMatchObject({ code: "user_not_found" });
  });

  it("requires confirmation for owner self-demotion and succeeds with another owner", async () => {
    await createUser(otherOwner, "owner");

    await expect(updateUserRole({
      workspaceId,
      actorUserId: owner.userId,
      targetUserId: owner.userId,
      role: "admin"
    })).rejects.toMatchObject({ code: "self_demote_confirmation_required" });

    const updated = await updateUserRole({
      workspaceId,
      actorUserId: owner.userId,
      targetUserId: owner.userId,
      role: "admin",
      confirmSelfDemotion: true
    });
    expect(updated.role).toBe("admin");
  });
});
