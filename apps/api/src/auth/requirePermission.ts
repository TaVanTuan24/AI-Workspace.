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

export async function resolveWorkspaceRole(request: FastifyRequest): Promise<WorkspaceRole | null> {
  if (request.workspaceRole) return request.workspaceRole;
  if (!request.user?.id) return null;

  // Single-user/self-host: the role lives on the user (set by attachLocalUser),
  // there is no per-workspace membership to resolve.
  const role = normalizeWorkspaceRole(request.user.role);
  request.workspaceRole = role;
  request.workspacePermissions = getPermissionsForRole(role);
  return role;
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
