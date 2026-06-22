import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../services/prisma.js";
import {
  getPermissionsForRole,
  hasAnyPermission,
  hasPermission,
  normalizeWorkspaceRole,
  type Permission,
  type WorkspaceRole
} from "./permissions.js";

declare module "fastify" {
  interface FastifyRequest {
    workspaceRole?: WorkspaceRole;
    workspacePermissions?: Permission[];
  }
}

import { getWorkspaceContextForRequest } from "./workspaceContext.js";

export async function resolveWorkspaceRole(request: FastifyRequest): Promise<WorkspaceRole | null> {
  if (request.workspaceRole) return request.workspaceRole;
  if (!request.user?.id) return null;

  try {
    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx) return null;

    request.workspaceRole = ctx.role;
    request.workspacePermissions = ctx.permissions;
    return ctx.role;
  } catch (err: any) {
    if (err.message === "workspace_required") {
      return null; // The require*Permission functions will send 401, but we should return a specific value if we want 403.
    }
    throw err;
  }
}

export async function requirePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  permission: Permission
): Promise<boolean> {
  const role = await resolveWorkspaceRole(request);
  if (!role) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }

  if (hasPermission(role, permission)) return true;

  await auditPermissionDenied(request, permission);
  reply.code(403).send({ error: "permission_denied" });
  return false;
}

export async function requireAnyPermission(
  request: FastifyRequest,
  reply: FastifyReply,
  permissions: readonly Permission[]
): Promise<boolean> {
  const role = await resolveWorkspaceRole(request);
  if (!role) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }

  if (hasAnyPermission(role, permissions)) return true;

  await auditPermissionDenied(request, permissions.join("|"));
  reply.code(403).send({ error: "permission_denied" });
  return false;
}

async function auditPermissionDenied(request: FastifyRequest, permission: string) {
  if (!request.user?.id) return;

  const route = request.routeOptions?.url ?? request.url.split("?")[0];

  try {
    await prisma.auditLog.create({
      data: {
        userId: request.user.id,
        action: "permission.denied",
        result: "denied",
        requestId: request.id,
        metadataSafeJson: JSON.stringify({ permission, route })
      }
    });
  } catch {
    // Permission failures must never expose audit persistence details to callers.
  }
}
