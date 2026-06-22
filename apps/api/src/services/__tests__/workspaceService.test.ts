import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../services/prisma.js";
import { ensureDefaultWorkspace, getWorkspaceForUser, getWorkspaceById } from "../../services/workspaceService.js";
import { withTestUserScope, cleanupTestUserData } from "../../test/testIsolation.js";

describe("workspaceService", () => {
  // Bootstrap tests must be allowed to trigger fallback workspace behavior
  process.env.UAIW_TEST_FAIL_ON_DEFAULT_WORKSPACE_FALLBACK = "false";

  const scope = withTestUserScope("workspace-svc");

  afterEach(async () => {
    await scope.cleanup();
  });

  it("creates default workspace idempotently", async () => {
    const first = await ensureDefaultWorkspace();
    expect(first.slug).toBe("local");
    expect(first.name).toBe("Local Workspace");

    const second = await ensureDefaultWorkspace();
    expect(second.id).toBe(first.id);
  });

  it("backfills users without workspace on ensureDefaultWorkspace", async () => {
    // Create user without workspace
    await prisma.user.create({
      data: { id: scope.userId, email: scope.email, role: "owner" }
    });

    const userBefore = await prisma.user.findUnique({ where: { id: scope.userId }, select: { workspaceId: true } });
    expect(userBefore?.workspaceId).toBeNull();

    const ws = await ensureDefaultWorkspace();

    const userAfter = await prisma.user.findUnique({ where: { id: scope.userId }, select: { workspaceId: true } });
    expect(userAfter?.workspaceId).toBe(ws.id);
  });

  it("getWorkspaceForUser returns workspace", async () => {
    const ws = await ensureDefaultWorkspace();
    await prisma.user.create({
      data: { id: scope.userId, email: scope.email, role: "owner", workspaceId: ws.id }
    });

    const result = await getWorkspaceForUser(scope.userId);
    expect(result?.id).toBe(ws.id);
    expect(result?.slug).toBe("local");
  });

  it("getWorkspaceById returns safe DTO", async () => {
    const ws = await ensureDefaultWorkspace();
    const result = await getWorkspaceById(ws.id);
    expect(result).toMatchObject({ id: ws.id, name: "Local Workspace", slug: "local" });
    // Should not contain internal DB fields
    expect(result).not.toHaveProperty("_count");
  });
});

describe("workspace context — user scoping", () => {
  const ownerScope = withTestUserScope("ws-ctx-owner");
  const memberScope = withTestUserScope("ws-ctx-member");
  const otherWsScope = withTestUserScope("ws-ctx-other");

  afterEach(async () => {
    await ownerScope.cleanup();
    await memberScope.cleanup();
    await otherWsScope.cleanup();
    // Clean up the separate workspace if created
    await prisma.workspace.deleteMany({ where: { slug: "other-workspace" } });
  });

  it("owner lists only users in own workspace", async () => {
    const ws = await ensureDefaultWorkspace();

    await prisma.user.create({
      data: { id: ownerScope.userId, email: ownerScope.email, role: "owner", workspaceId: ws.id }
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: ws.id, userId: ownerScope.userId, role: "owner", status: "active" }
    });

    await prisma.user.create({
      data: { id: memberScope.userId, email: memberScope.email, role: "member", workspaceId: ws.id }
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: ws.id, userId: memberScope.userId, role: "member", status: "active" }
    });

    // Create user in a different workspace
    const otherWs = await prisma.workspace.upsert({
      where: { slug: "other-workspace" },
      create: { name: "Other", slug: "other-workspace" },
      update: {}
    });
    await prisma.user.create({
      data: { id: otherWsScope.userId, email: otherWsScope.email, role: "member", workspaceId: otherWs.id }
    });
    await prisma.workspaceMembership.create({
      data: { workspaceId: otherWs.id, userId: otherWsScope.userId, role: "member", status: "active" }
    });

    // Import dynamically to avoid circular issues
    const { listUsers } = await import("../../services/userManagementService.js");
    const users = await listUsers({ workspaceId: ws.id });

    const userIds = users.map(u => u.id);
    expect(userIds).toContain(ownerScope.userId);
    expect(userIds).toContain(memberScope.userId);
    expect(userIds).not.toContain(otherWsScope.userId);
  });
});
