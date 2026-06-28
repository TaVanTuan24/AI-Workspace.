import { prisma } from "../services/prisma.js";
import { makeTestRunId } from "./testIsolation.js";

// Post-workspace-removal: a minimal per-test local-user context. The name is
// kept for compatibility with existing route tests; there is no workspace
// concept anymore — just an isolated user and its request auth header.
export interface WorkspaceTestContext {
  userId: string;
  email: string;
}

export async function createWorkspaceTestContext(prefix: string): Promise<WorkspaceTestContext> {
  const runId = makeTestRunId(prefix);
  const userId = `user-${runId}`;
  const email = `${userId}@test.local`;

  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, email, role: "owner" }
  });

  return { userId, email };
}

export function buildAuthHeaders(ctx: WorkspaceTestContext): Record<string, string> {
  return { "x-local-user-id": ctx.userId };
}
