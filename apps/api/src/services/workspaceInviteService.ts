import { randomBytes, createHash } from "node:crypto";
import { prisma } from "./prisma.js";
import { normalizeWorkspaceRole, type WorkspaceRole } from "../auth/permissions.js";

export class WorkspaceInviteError extends Error {
  constructor(
    public readonly code:
      | "invite_not_found"
      | "invite_expired"
      | "invite_already_accepted"
      | "invite_revoked"
      | "invalid_role"
      | "already_member"
      | "already_invited"
      | "email_mismatch"
  ) {
    super(code);
  }
}

export interface WorkspaceInviteView {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: string;
  expiresAt: string;
  createdAt: string;
  latestDelivery?: {
    channel: string;
    status: string;
    createdAt: string;
  };
}

export interface WorkspaceInviteCreateResult {
  invite: WorkspaceInviteView;
  rawToken: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createWorkspaceInvite({
  workspaceId,
  email,
  role,
  actorUserId
}: {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  actorUserId: string;
}): Promise<WorkspaceInviteCreateResult> {
  const normalizedEmail = email.toLowerCase().trim();

  // Check if already a member
  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existingUser) {
    const existingMembership = await prisma.workspaceMembership.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: existingUser.id }
      }
    });
    if (existingMembership?.status === "active") {
      throw new WorkspaceInviteError("already_member");
    }
  }

  // Check for existing pending invite
  const existingInvite = await prisma.workspaceInvite.findFirst({
    where: {
      workspaceId,
      email: normalizedEmail,
      status: "pending",
      expiresAt: { gt: new Date() }
    }
  });

  if (existingInvite) {
    throw new WorkspaceInviteError("already_invited");
  }

  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);

  // Expire in 7 days
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invite = await prisma.workspaceInvite.create({
    data: {
      workspaceId,
      email: normalizedEmail,
      role,
      tokenHash,
      status: "pending",
      expiresAt,
      invitedByUserId: actorUserId
    }
  });

  return {
    invite: toInviteView(invite),
    rawToken
  };
}

export async function listWorkspaceInvites({ workspaceId }: { workspaceId: string }): Promise<WorkspaceInviteView[]> {
  const invites = await prisma.workspaceInvite.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    include: {
      deliveryAttempts: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  return invites.map(invite => {
    const view = toInviteView(invite);
    if (invite.deliveryAttempts && invite.deliveryAttempts.length > 0) {
      const attempt = invite.deliveryAttempts[0];
      view.latestDelivery = {
        channel: attempt.channel,
        status: attempt.status,
        createdAt: attempt.createdAt.toISOString()
      };
    }
    return view;
  });
}

export async function revokeWorkspaceInvite({
  workspaceId,
  inviteId
}: {
  workspaceId: string;
  inviteId: string;
}): Promise<WorkspaceInviteView> {
  const invite = await prisma.workspaceInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.workspaceId !== workspaceId) {
    throw new WorkspaceInviteError("invite_not_found");
  }
  if (invite.status !== "pending") {
    throw new WorkspaceInviteError("invite_not_found");
  }

  const updated = await prisma.workspaceInvite.update({
    where: { id: inviteId },
    data: {
      status: "revoked",
      revokedAt: new Date()
    }
  });

  return toInviteView(updated);
}

export async function acceptWorkspaceInvite({ token, userId }: { token: string; userId: string }) {
  const tokenHash = hashToken(token);

  return prisma.$transaction(async (tx) => {
    const invite = await tx.workspaceInvite.findFirst({
      where: { tokenHash }
    });

    if (!invite) throw new WorkspaceInviteError("invite_not_found");
    if (invite.status === "accepted") throw new WorkspaceInviteError("invite_already_accepted");
    if (invite.status === "revoked") throw new WorkspaceInviteError("invite_revoked");
    
    if (invite.expiresAt < new Date()) {
      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data: { status: "expired" }
      });
      throw new WorkspaceInviteError("invite_expired");
    }

    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new WorkspaceInviteError("invite_not_found");

    if (user.email !== invite.email) {
      throw new WorkspaceInviteError("email_mismatch");
    }

    // Check if membership already exists
    const existingMembership = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } }
    });

    if (existingMembership && existingMembership.status === "active") {
      throw new WorkspaceInviteError("invite_already_accepted");
    }

    // Create or update membership
    await tx.workspaceMembership.upsert({
      where: {
        workspaceId_userId: { workspaceId: invite.workspaceId, userId }
      },
      create: {
        workspaceId: invite.workspaceId,
        userId,
        role: invite.role,
        status: "active"
      },
      update: {
        role: invite.role,
        status: "active"
      }
    });

    // Accept the invite
    const acceptedInvite = await tx.workspaceInvite.update({
      where: { id: invite.id },
      data: {
        status: "accepted",
        acceptedAt: new Date()
      }
    });

    await tx.userRoleAuditEvent.create({
      data: {
        workspaceId: invite.workspaceId,
        actorUserId: invite.invitedByUserId,
        targetUserId: userId,
        inviteId: invite.id,
        nextRole: invite.role,
        action: existingMembership ? "membership_enabled" : "membership_created"
      }
    });

    // If user has no workspaceId on their profile (transitional), set it
    if (!user.workspaceId) {
      await tx.user.update({
        where: { id: userId },
        data: { workspaceId: invite.workspaceId }
      });
    }

    return { workspaceId: acceptedInvite.workspaceId };
  });
}

function toInviteView(invite: {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}): WorkspaceInviteView {
  return {
    id: invite.id,
    email: invite.email,
    role: normalizeWorkspaceRole(invite.role),
    status: invite.status,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString()
  };
}

export async function expireInvites({
  now = new Date(),
  limit = 1000,
  dryRun = false
}: {
  now?: Date;
  limit?: number;
  dryRun?: boolean;
}) {
  const pendingExpired = await prisma.workspaceInvite.findMany({
    where: {
      status: "pending",
      expiresAt: { lte: now }
    },
    take: limit,
    select: { id: true, workspaceId: true, invitedByUserId: true, role: true }
  });

  if (pendingExpired.length === 0) {
    return { scanned: 0, expired: 0, skipped: 0, dryRun };
  }

  if (dryRun) {
    return {
      scanned: pendingExpired.length,
      expired: pendingExpired.length,
      skipped: 0,
      dryRun
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const { count } = await tx.workspaceInvite.updateMany({
      where: {
        id: { in: pendingExpired.map(i => i.id) },
        status: "pending"
      },
      data: {
        status: "expired"
      }
    });

    if (count > 0) {
      await tx.userRoleAuditEvent.createMany({
        data: pendingExpired.map(i => ({
          workspaceId: i.workspaceId,
          actorUserId: i.invitedByUserId,
          inviteId: i.id,
          nextRole: i.role,
          action: "invite_expired"
        }))
      });
    }
    
    return { count };
  });

  return {
    scanned: pendingExpired.length,
    expired: result.count,
    skipped: pendingExpired.length - result.count,
    dryRun
  };
}
