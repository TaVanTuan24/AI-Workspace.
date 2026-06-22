import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { prisma } from "../services/prisma.js";
import { makeTestRunId } from "./testIsolation.js";
import { getPermissionsForRole, normalizeWorkspaceRole, type WorkspaceRole, type Permission } from "../auth/permissions.js";

export interface WorkspaceTestContext {
  userId: string;
  workspaceId: string;
  membershipId: string;
  role: WorkspaceRole;
  permissions: Permission[];
  email: string;
}

export interface CreateWorkspaceTestContextOptions {
  role?: "owner" | "admin" | "member" | "viewer";
  workspaceName?: string;
  userEmail?: string;
}

/**
 * Creates an isolated user, workspace, and membership for testing without
 * relying on the implicit default workspace fallback.
 */
export async function createWorkspaceTestContext(
  prefix: string,
  options?: CreateWorkspaceTestContextOptions
): Promise<WorkspaceTestContext> {
  const runId = makeTestRunId(prefix);
  const userId = `user-${runId}`;
  const workspaceId = `ws-${runId}`;
  const membershipId = `mem-${runId}`;
  
  const email = options?.userEmail || `${userId}@test.local`;
  const role = options?.role || "owner";
  const name = options?.workspaceName || `Test Workspace ${runId}`;
  
  await prisma.workspace.create({
    data: {
      id: workspaceId,
      name,
      slug: `test-ws-${runId}`,
    }
  });

  await prisma.user.create({
    data: {
      id: userId,
      email,
      role: "owner", // Base user role, membership role overrides it
      workspaceId
    }
  });

  await prisma.workspaceMembership.create({
    data: {
      id: membershipId,
      userId,
      workspaceId,
      role,
      status: "active"
    }
  });

  const normalizedRole = normalizeWorkspaceRole(role);
  const permissions = getPermissionsForRole(normalizedRole);

  return {
    userId,
    workspaceId,
    membershipId,
    role: normalizedRole,
    permissions,
    email
  };
}

/**
 * Mock data representing a workspace context, used in combination with mockWorkspaceContext().
 */
export function mockWorkspaceContext(
  context: Partial<WorkspaceTestContext> = {}
): WorkspaceTestContext {
  const role = normalizeWorkspaceRole(context.role || "owner");
  return {
    userId: context.userId || "test-user-id",
    workspaceId: context.workspaceId || "test-workspace-id",
    membershipId: context.membershipId || "test-membership-id",
    role,
    permissions: getPermissionsForRole(role),
    email: context.email || "test@example.com"
  };
}

/**
 * Returns the headers required to inject authentication for this context
 * in Fastify tests.
 */
export function buildAuthHeaders(context: { userId: string }) {
  return {
    "x-local-user-id": context.userId
  };
}
