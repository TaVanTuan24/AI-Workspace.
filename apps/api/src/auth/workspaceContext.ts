import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../services/prisma.js";
import { env } from "../config/env.js";
import { ensureDefaultWorkspace } from "../services/workspaceService.js";
import {
  getPermissionsForRole,
  normalizeWorkspaceRole,
  type Permission,
  type WorkspaceRole
} from "./permissions.js";

export interface WorkspaceContext {
  userId: string;
  workspaceId: string;
  membershipId: string;
  role: WorkspaceRole;
  permissions: Permission[];
}

declare module "fastify" {
  interface FastifyRequest {
    workspaceContext?: WorkspaceContext;
  }
}

/**
 * Resolves the full workspace context for a request. This is the authoritative
 * source of truth for workspace membership and role — the client cannot
 * override it.
 */
export async function getWorkspaceContextForRequest(
  request: FastifyRequest
): Promise<WorkspaceContext | null> {
  // Return cached if already resolved this request
  if (request.workspaceContext) return request.workspaceContext;
  if (!request.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: request.user.id },
    select: { id: true, role: true, workspaceId: true }
  });

  if (!user) return null;

  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId: user.id, status: "active" },
    include: { workspace: true }
  });

  let membership = memberships.find((m) => m.workspaceId === user.workspaceId);

  if (!membership && memberships.length > 0) {
    membership = memberships[0];
    // Silently fix transitional workspaceId if we found an active membership
    await prisma.user.update({
      where: { id: user.id },
      data: { workspaceId: membership.workspaceId }
    });
  }

  let workspaceId = membership?.workspaceId;
  let rawRole = membership?.role;

  if (!membership) {
    // A user with no *active* membership may still have an explicitly
    // disabled/suspended one. That is a deliberate admin action and must not
    // be silently re-granted by the single-user fallback below. Deny instead.
    const blockedMembership = await prisma.workspaceMembership.findFirst({
      where: { userId: user.id, status: { not: "active" } },
      select: { id: true }
    });
    if (blockedMembership) {
      return null;
    }

    // Only fallback if local single user mode is enabled
    if (!env.LOCAL_SINGLE_USER_MODE) {
      throw new Error("workspace_required");
    }

    if (process.env.NODE_ENV === "test") {
      if (process.env.UAIW_TEST_FAIL_ON_DEFAULT_WORKSPACE_FALLBACK === "true") {
        throw new Error(
          "Test isolation violation: Default workspace fallback triggered in test. " +
          "Use createWorkspaceTestContext() or mockWorkspaceContext() to avoid this."
        );
      } else {
        console.warn("[TEST WARNING] Implicit default workspace fallback triggered.");
      }
    }

    workspaceId = user.workspaceId ?? undefined;

    if (!workspaceId) {
      const defaultWorkspace = await ensureDefaultWorkspace();
      workspaceId = defaultWorkspace.id;

      await prisma.user.update({
        where: { id: user.id },
        data: { workspaceId }
      });
    }

    rawRole = user.role || "owner";

    // Auto-create membership to backfill single-user local instances
    membership = await prisma.workspaceMembership.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: workspaceId,
          userId: user.id
        }
      },
      create: {
        workspaceId,
        userId: user.id,
        role: rawRole,
        status: "active"
      },
      update: {
        status: "active",
        role: rawRole
      },
      include: { workspace: true }
    });
  }

  const role = normalizeWorkspaceRole(rawRole);
  const permissions = getPermissionsForRole(role);

  const ctx: WorkspaceContext = {
    userId: user.id,
    workspaceId: workspaceId!,
    membershipId: membership.id,
    role,
    permissions
  };

  request.workspaceContext = ctx;
  return ctx;
}

/**
 * Guard that requires a valid workspace context on the request.
 * Returns the context or sends a 401/403 and returns null.
 */
export async function requireWorkspaceContext(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<WorkspaceContext | null> {
  try {
    const ctx = await getWorkspaceContextForRequest(request);

    if (!ctx) {
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }

    return ctx;
  } catch (error: any) {
    if (error.message === "workspace_required") {
      reply.code(403).send({ error: "workspace_required" });
      return null;
    }
    throw error;
  }
}
