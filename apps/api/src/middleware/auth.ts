import type { FastifyRequest } from "fastify";
import { normalizeWorkspaceRole, type WorkspaceRole } from "../auth/permissions.js";
import { prisma } from "../services/prisma.js";
import { env } from "../config/env.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role?: WorkspaceRole;
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
  //
  // Fail closed: this hook trusts the `x-local-user-id` header and auto-
  // provisions an "owner" user. That is only acceptable in local single-user
  // mode. If someone deploys to production with LOCAL_SINGLE_USER_MODE=false
  // (signalling they expect real auth, which does not exist yet), reject the
  // request instead of silently allowing impersonation.
  if (env.NODE_ENV === "production" && !env.LOCAL_SINGLE_USER_MODE) {
    const err = new Error(
      "Header-based local authentication is disabled in production. Real authentication is not implemented yet (M2)."
    ) as Error & { statusCode?: number };
    err.statusCode = 401;
    throw err;
  }

  const localUser = {
    id: request.headers["x-local-user-id"]?.toString() ?? "local-user",
    email: "local@example.com"
  };

  const user = await prisma.user.upsert({
    where: { id: localUser.id },
    create: {
      id: localUser.id,
      email: localUser.email,
      role: "owner",
      displayName: "Local User"
    },
    update: {},
    select: {
      id: true,
      email: true,
      role: true
    }
  });

  request.user = {
    id: user.id,
    email: user.email,
    role: normalizeWorkspaceRole(user.role)
  };
}

