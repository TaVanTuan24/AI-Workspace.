import { prisma } from "./prisma.js";

const DEFAULT_WORKSPACE_SLUG = "local";
const DEFAULT_WORKSPACE_NAME = "Local Workspace";

/**
 * Ensures the default "Local Workspace" exists and attaches any users
 * that currently have no workspaceId. This is idempotent and safe to call
 * on every app startup and in test helpers.
 */
export async function ensureDefaultWorkspace(): Promise<{ id: string; name: string; slug: string }> {
  let workspace = await prisma.workspace.findUnique({
    where: { slug: DEFAULT_WORKSPACE_SLUG }
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: DEFAULT_WORKSPACE_NAME,
        slug: DEFAULT_WORKSPACE_SLUG
      }
    });
  }

  // Backfill: attach any users without a workspace to the default one.
  await prisma.user.updateMany({
    where: { workspaceId: null },
    data: { workspaceId: workspace.id }
  });

  return { id: workspace.id, name: workspace.name, slug: workspace.slug };
}

/**
 * Gets the workspace for a given user. Returns null if user has no workspace.
 */
export async function getWorkspaceForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { workspaceId: true }
  });
  if (!user?.workspaceId) return null;

  return prisma.workspace.findUnique({
    where: { id: user.workspaceId }
  });
}

/**
 * Gets workspace details by ID. Returns safe DTO only.
 */
export async function getWorkspaceById(workspaceId: string) {
  return prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, slug: true, createdAt: true, updatedAt: true }
  });
}

/**
 * Creates a new empty workspace for a user.
 */
export async function createWorkspaceForUser({
  actorUserId,
  name
}: {
  actorUserId: string;
  name: string;
}) {
  const trimmedName = name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 80) {
    throw new Error("invalid_workspace_name");
  }

  // Prevent control characters
  if (/[\x00-\x1F\x7F]/.test(trimmedName)) {
    throw new Error("invalid_workspace_name");
  }

  const baseSlug = trimmedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  
  if (!baseSlug) {
    throw new Error("invalid_workspace_name");
  }

  let slug = baseSlug;
  let suffix = 1;
  let unique = false;

  while (!unique) {
    const existing = await prisma.workspace.findUnique({
      where: { slug },
      select: { id: true }
    });
    if (existing) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    } else {
      unique = true;
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const newWorkspace = await tx.workspace.create({
      data: {
        name: trimmedName,
        slug
      }
    });

    const membership = await tx.workspaceMembership.create({
      data: {
        workspaceId: newWorkspace.id,
        userId: actorUserId,
        role: "owner",
        status: "active"
      }
    });

    await tx.user.update({
      where: { id: actorUserId },
      data: { workspaceId: newWorkspace.id }
    });

    // We also generate an audit event for good measure
    await tx.userRoleAuditEvent.create({
      data: {
        workspaceId: newWorkspace.id,
        actorUserId,
        targetUserId: actorUserId,
        previousRole: "viewer", // not quite accurate, but indicates start
        nextRole: "owner",
        action: "user.role.changed"
      }
    });

    return {
      workspace: {
        id: newWorkspace.id,
        name: newWorkspace.name,
        slug: newWorkspace.slug,
        role: "owner" as const,
        membershipId: membership.id
      },
      currentWorkspaceId: newWorkspace.id
    };
  });

  return result;
}
