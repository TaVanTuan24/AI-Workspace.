import { normalizeWorkspaceRole, WORKSPACE_ROLES, type WorkspaceRole } from "../auth/permissions.js";
import { prisma } from "./prisma.js";

export interface UserManagementView {
  id: string;
  email: string | null;
  name: string | null;
  role: WorkspaceRole;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserRoleAuditEventView {
  id: string;
  actorUserId: string;
  targetUserId: string | null;
  previousRole: WorkspaceRole | null;
  nextRole: WorkspaceRole | null;
  action: string;
  createdAt: string;
}

export class UserManagementError extends Error {
  constructor(
    public readonly code:
      | "permission_denied"
      | "invalid_role"
      | "user_not_found"
      | "last_owner_required"
      | "self_demote_confirmation_required"
  ) {
    super(code);
  }
}

export async function listUsers({ workspaceId }: { workspaceId: string }): Promise<UserManagementView[]> {
  const users = await prisma.workspaceMembership.findMany({
    where: { workspaceId },
    select: {
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          displayName: true
        }
      }
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }]
  });

  return users.map(toUserManagementView);
}

export async function getUserManagementSummary({ workspaceId }: { workspaceId: string }) {
  const users = await listUsers({ workspaceId });
  return {
    total: users.length,
    owners: users.filter((user) => user.role === "owner").length,
    admins: users.filter((user) => user.role === "admin").length,
    members: users.filter((user) => user.role === "member").length,
    viewers: users.filter((user) => user.role === "viewer").length
  };
}

export async function updateUserRole({
  workspaceId,
  actorUserId,
  targetUserId,
  role,
  confirmSelfDemotion = false
}: {
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
  role: string;
  confirmSelfDemotion?: boolean;
}): Promise<UserManagementView> {
  if (!isWorkspaceRole(role)) throw new UserManagementError("invalid_role");

  return prisma.$transaction(async (tx) => {
    if (actorUserId !== targetUserId) {
      const actorMembership = await tx.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: actorUserId } }
      });
      if (actorMembership?.role !== "owner") {
        throw new UserManagementError("permission_denied");
      }
    }

    const targetMembership = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      include: { user: true }
    });
    if (!targetMembership || targetMembership.status !== "active") {
      throw new UserManagementError("user_not_found");
    }

    const previousRole = normalizeWorkspaceRole(targetMembership.role);
    const nextRole = role;
    if (previousRole === nextRole) return toUserManagementView(targetMembership);

    if (previousRole === "owner" && nextRole !== "owner") {
      const ownerCount = await tx.workspaceMembership.count({
        where: { workspaceId, role: "owner", status: "active" }
      });
      if (ownerCount <= 1) throw new UserManagementError("last_owner_required");

      if (actorUserId === targetUserId && !confirmSelfDemotion) {
        throw new UserManagementError("self_demote_confirmation_required");
      }
    }

    const updatedMembership = await tx.workspaceMembership.update({
      where: { id: targetMembership.id },
      data: { role: nextRole },
      include: { user: true }
    });

    // Fallback sync for backwards compatibility until User.role is fully deprecated
    await tx.user.update({
      where: { id: targetUserId },
      data: { role: nextRole }
    });

    await tx.userRoleAuditEvent.create({
      data: {
        workspaceId,
        actorUserId,
        targetUserId,
        previousRole,
        nextRole,
        previousStatus: targetMembership.status,
        nextStatus: targetMembership.status,
        action: "user.role.changed"
      }
    });

    return toUserManagementView(updatedMembership);
  });
}

export interface WorkspaceAuditEventView {
  id: string;
  actorUserId: string;
  targetUserId: string | null;
  previousRole: WorkspaceRole | null;
  nextRole: WorkspaceRole | null;
  previousStatus: string | null;
  nextStatus: string | null;
  inviteId: string | null;
  action: string;
  createdAt: string;
}

export async function listWorkspaceAuditEvents({
  workspaceId,
  limit = 50
}: {
  workspaceId: string;
  limit?: number;
}): Promise<WorkspaceAuditEventView[]> {
  const events = await prisma.userRoleAuditEvent.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100)
  });

  return events.map((event) => ({
    id: event.id,
    actorUserId: event.actorUserId,
    targetUserId: event.targetUserId,
    previousRole: event.previousRole ? normalizeWorkspaceRole(event.previousRole) : null,
    nextRole: event.nextRole ? normalizeWorkspaceRole(event.nextRole) : null,
    previousStatus: event.previousStatus,
    nextStatus: event.nextStatus,
    inviteId: event.inviteId,
    action: event.action,
    createdAt: event.createdAt.toISOString()
  }));
}

function toUserManagementView(membership: {
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; email: string | null; displayName: string | null };
}): UserManagementView {
  return {
    id: membership.user.id,
    email: membership.user.email,
    name: membership.user.displayName,
    role: normalizeWorkspaceRole(membership.role),
    status: membership.status,
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString()
  };
}

function isWorkspaceRole(role: string): role is WorkspaceRole {
  return WORKSPACE_ROLES.includes(role as WorkspaceRole);
}
