import type { FastifyRequest } from "fastify";
import { normalizeWorkspaceRole, type WorkspaceRole } from "../auth/permissions.js";
import { prisma } from "../services/prisma.js";
import { ensureDefaultWorkspace } from "../services/workspaceService.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role?: WorkspaceRole;
  workspaceId?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser;
    apiKeyId?: string;
    apiKeyPrefix?: string;
    rateLimitPerMinute?: number | null;
  }
}

export async function attachLocalUser(request: FastifyRequest) {
  // MVP placeholder. Replace with signed cookie/session validation in M2.
  // Never derive provider access from frontend input.
  const localUser = {
    id: request.headers["x-local-user-id"]?.toString() ?? "local-user",
    email: "local@example.com"
  };

  // Ensure default workspace exists for backfill
  const defaultWorkspace = await ensureDefaultWorkspace();

  const user = await prisma.user.upsert({
    where: { id: localUser.id },
    create: {
      id: localUser.id,
      email: localUser.email,
      role: "owner",
      displayName: "Local User",
      workspaceId: defaultWorkspace.id
    },
    update: {},
    select: {
      id: true,
      email: true,
      role: true,
      workspaceId: true
    }
  });

  // Backfill: if existing user has no workspace, attach to default
  if (!user.workspaceId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { workspaceId: defaultWorkspace.id }
    });
    user.workspaceId = defaultWorkspace.id;
  }

  request.user = {
    id: user.id,
    email: user.email,
    role: normalizeWorkspaceRole(user.role),
    workspaceId: user.workspaceId ?? undefined
  };
}

