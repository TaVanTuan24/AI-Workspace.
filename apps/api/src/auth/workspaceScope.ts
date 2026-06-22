/**
 * Workspace scoping query helpers
 */

/**
 * Appends the workspaceId constraint to a prisma where clause.
 */
export function scopeByWorkspace<T extends object>(where: T, workspaceId: string): T & { workspaceId: string } {
  return { ...where, workspaceId };
}

/**
 * Asserts that the record belongs to the same workspace as the current context.
 * Provides a fallback for records that have not been backfilled yet,
 * strictly matching the userId.
 */
export function assertSameWorkspace(
  recordWorkspaceId: string | null,
  contextWorkspaceId: string,
  currentUserId?: string,
  recordUserId?: string
) {
  if (recordWorkspaceId) {
    if (recordWorkspaceId !== contextWorkspaceId) {
      const error = new Error("Cross-workspace access denied.");
      (error as any).code = "cross_workspace_access_denied";
      throw error;
    }
  } else if (currentUserId && recordUserId) {
    // Transitional fallback: if record does not have a workspaceId yet, allow if it belongs to current user.
    if (currentUserId !== recordUserId) {
      const error = new Error("Cross-workspace access denied.");
      (error as any).code = "cross_workspace_access_denied";
      throw error;
    }
  } else {
    const error = new Error("Workspace resolution failed on record.");
    (error as any).code = "workspace_resolution_failed";
    throw error;
  }
}

/**
 * Asserts that a record belongs to the current execution context.
 */
export function requireWorkspaceOwnedRecord(
  record: { workspaceId?: string | null; userId?: string },
  context: { workspaceId: string; userId: string }
) {
  assertSameWorkspace(record.workspaceId ?? null, context.workspaceId, context.userId, record.userId);
}
