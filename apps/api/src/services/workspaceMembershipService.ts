import { prisma } from "./prisma.js";

export class WorkspaceMembershipError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export async function disableMembership({
  actorUserId,
  workspaceId,
  membershipId
}: {
  actorUserId: string;
  workspaceId: string;
  membershipId: string;
}) {
  return await prisma.$transaction(async tx => {
    // 1. Check actor is an owner
    const actorMembership = await tx.workspaceMembership.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: actorUserId }
      }
    });

    if (!actorMembership || actorMembership.status !== "active" || actorMembership.role !== "owner") {
      throw new WorkspaceMembershipError("permission_denied");
    }

    // 2. Fetch the target membership
    const targetMembership = await tx.workspaceMembership.findUnique({
      where: { id: membershipId }
    });

    if (!targetMembership || targetMembership.workspaceId !== workspaceId) {
      throw new WorkspaceMembershipError("membership_not_found");
    }

    if (targetMembership.status === "disabled") {
      throw new WorkspaceMembershipError("membership_already_disabled");
    }

    // 3. Prevent disabling last active owner
    if (targetMembership.role === "owner") {
      const activeOwnersCount = await tx.workspaceMembership.count({
        where: {
          workspaceId,
          role: "owner",
          status: "active"
        }
      });
      if (activeOwnersCount <= 1) {
        throw new WorkspaceMembershipError("last_owner_required");
      }
    }

    // 4. Update status
    const updated = await tx.workspaceMembership.update({
      where: { id: membershipId },
      data: { status: "disabled" }
    });

    // 5. Log audit event
    await tx.userRoleAuditEvent.create({
      data: {
        workspaceId,
        actorUserId,
        targetUserId: targetMembership.userId,
        previousRole: targetMembership.role,
        nextRole: targetMembership.role,
        previousStatus: targetMembership.status,
        nextStatus: "disabled",
        action: "membership_disabled"
      }
    });

    return updated;
  });
}

export async function enableMembership({
  actorUserId,
  workspaceId,
  membershipId
}: {
  actorUserId: string;
  workspaceId: string;
  membershipId: string;
}) {
  return await prisma.$transaction(async tx => {
    // 1. Check actor is an owner
    const actorMembership = await tx.workspaceMembership.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: actorUserId }
      }
    });

    if (!actorMembership || actorMembership.status !== "active" || actorMembership.role !== "owner") {
      throw new WorkspaceMembershipError("permission_denied");
    }

    // 2. Fetch the target membership
    const targetMembership = await tx.workspaceMembership.findUnique({
      where: { id: membershipId }
    });

    if (!targetMembership || targetMembership.workspaceId !== workspaceId) {
      throw new WorkspaceMembershipError("membership_not_found");
    }

    if (targetMembership.status === "active") {
      throw new WorkspaceMembershipError("membership_already_active");
    }

    // 3. Update status
    const updated = await tx.workspaceMembership.update({
      where: { id: membershipId },
      data: { status: "active" }
    });

    // 4. Log audit event
    await tx.userRoleAuditEvent.create({
      data: {
        workspaceId,
        actorUserId,
        targetUserId: targetMembership.userId,
        previousRole: targetMembership.role,
        nextRole: targetMembership.role,
        previousStatus: targetMembership.status,
        nextStatus: "active",
        action: "membership_enabled"
      }
    });

    return updated;
  });
}
