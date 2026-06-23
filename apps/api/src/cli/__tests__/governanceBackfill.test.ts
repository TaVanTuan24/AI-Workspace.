import { describe, it, expect, beforeEach } from "vitest";
import { backfillGovernance } from "../governance-backfill.js";
import { prisma } from "../../services/prisma.js";

describe("governanceBackfill", () => {
  beforeEach(async () => {
    // We cannot easily isolate the entire DB, but we can create a user missing things
    // and verify it gets fixed.
  });

  it("should assign missing workspaceId to users in apply mode", async () => {
    // Create a user completely bare
    const user = await prisma.user.create({
      data: {
        id: "test-orphan-user",
        email: "orphan@test.com",
        role: "member"
      }
    });

    try {
      // First, dry run
      await backfillGovernance(true);

      let u = await prisma.user.findUnique({ where: { id: user.id } });
      expect(u?.workspaceId).toBeNull();

      // Now apply
      await backfillGovernance(false);

      u = await prisma.user.findUnique({ where: { id: user.id } });
      expect(u?.workspaceId).not.toBeNull();

      // Also verify they got a membership
      const memberships = await prisma.workspaceMembership.findMany({
        where: { userId: user.id }
      });
      expect(memberships.length).toBeGreaterThan(0);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("should assign quotas to workspaces that don't have them", async () => {
    // Create a bare workspace
    const ws = await prisma.workspace.create({
      data: {
        name: "Test Missing Quota",
        slug: "test-missing-quota"
      }
    });

    try {
      await backfillGovernance(true);
      let quota = await prisma.workspaceQuota.findUnique({ where: { workspaceId: ws.id } });
      expect(quota).toBeNull();

      await backfillGovernance(false);
      quota = await prisma.workspaceQuota.findUnique({ where: { workspaceId: ws.id } });
      expect(quota).not.toBeNull();
      expect(quota?.plan).toBe("local");
    } finally {
      await prisma.workspace.delete({ where: { id: ws.id } });
    }
  });
});
