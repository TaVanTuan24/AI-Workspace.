import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, txMock } = vi.hoisted(() => {
  const tx = {
    user: {
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn()
    },
    workspaceMembership: {
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn()
    },
    userRoleAuditEvent: {
      create: vi.fn()
    }
  };

  return {
    txMock: tx,
    prismaMock: {
      $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx))
    }
  };
});

vi.mock("../prisma.js", () => ({
  prisma: prismaMock
}));

import { updateUserRole } from "../userManagementService.js";

describe("userManagementService last owner guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prevents demoting the last remaining owner", async () => {
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    txMock.workspaceMembership.findUnique
      .mockResolvedValueOnce({
        id: "membership-1",
        workspaceId: "ws-1",
        userId: "owner-1",
        role: "owner",
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
        user: { id: "owner-1", email: "owner@example.test", displayName: "Owner" }
      });
    txMock.workspaceMembership.count.mockResolvedValueOnce(1);

    await expect(updateUserRole({
      workspaceId: "ws-1",
      actorUserId: "owner-1",
      targetUserId: "owner-1",
      role: "admin",
      confirmSelfDemotion: true
    })).rejects.toMatchObject({ code: "last_owner_required" });
    expect(txMock.workspaceMembership.update).not.toHaveBeenCalled();
    expect(txMock.userRoleAuditEvent.create).not.toHaveBeenCalled();
  });
});
