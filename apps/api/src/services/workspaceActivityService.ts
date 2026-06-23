import { prisma } from "./prisma.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActivityCategory =
  | "membership"
  | "invite"
  | "invite_delivery"
  | "quota"
  | "notification"
  | "scheduler"
  | "provider_health"
  | "diagnostics"
  | "recovery"
  | "webhook"
  | "api_usage";

export type ActivitySeverity = "info" | "warning" | "error" | "critical";

export interface ActivityEvent {
  id: string;
  category: ActivityCategory;
  action: string;
  severity?: ActivitySeverity;
  title: string;
  summary: string;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
}

export interface ActivityTimelineResult {
  events: ActivityEvent[];
  nextCursor?: string;
}

export type ActivityRange = "24h" | "7d" | "30d" | "90d";

export const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  "membership", "invite", "invite_delivery", "quota", "notification",
  "scheduler", "provider_health", "diagnostics", "recovery", "webhook", "api_usage"
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rangeToDate(range: ActivityRange): Date {
  const now = new Date();
  const hours = { "24h": 24, "7d": 168, "30d": 720, "90d": 2160 }[range];
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function safeTruncate(value: unknown, maxLen = 200): string {
  const str = String(value ?? "");
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

function safeMetadata(
  raw: Record<string, unknown> | undefined
): Record<string, string | number | boolean | null> | undefined {
  if (!raw) return undefined;
  const result: Record<string, string | number | boolean | null> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= 20) break; // cap number of metadata fields
    if (value === null || value === undefined) {
      result[safeTruncate(key, 50)] = null;
    } else if (typeof value === "boolean") {
      result[safeTruncate(key, 50)] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      result[safeTruncate(key, 50)] = value;
    } else {
      result[safeTruncate(key, 50)] = safeTruncate(value);
    }
    count++;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// ---------------------------------------------------------------------------
// Event source collectors
// ---------------------------------------------------------------------------

async function collectMembershipEvents(
  workspaceId: string, since: Date, limit: number
): Promise<ActivityEvent[]> {
  const rows = await prisma.userRoleAuditEvent.findMany({
    where: { workspaceId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: `membership-${r.id}`,
    category: "membership" as ActivityCategory,
    action: r.action,
    severity: "info" as ActivitySeverity,
    title: `Role change: ${r.action}`,
    summary: r.previousRole && r.nextRole
      ? `Role changed from ${r.previousRole} to ${r.nextRole}`
      : `Membership action: ${r.action}`,
    metadata: safeMetadata({
      previousRole: r.previousRole,
      nextRole: r.nextRole,
      previousStatus: r.previousStatus,
      nextStatus: r.nextStatus,
    }),
    createdAt: r.createdAt.toISOString(),
    actorUserId: r.actorUserId,
    targetUserId: r.targetUserId,
  }));
}

async function collectInviteEvents(
  workspaceId: string, since: Date, limit: number
): Promise<ActivityEvent[]> {
  const rows = await prisma.workspaceInvite.findMany({
    where: { workspaceId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, status: true, role: true, createdAt: true,
      invitedByUserId: true,
    },
  });
  return rows.map((r) => ({
    id: `invite-${r.id}`,
    category: "invite" as ActivityCategory,
    action: r.status,
    severity: (r.status === "expired" || r.status === "revoked" ? "warning" : "info") as ActivitySeverity,
    title: `Invite ${r.status}`,
    summary: `Workspace invite with role ${r.role} is ${r.status}`,
    metadata: safeMetadata({ role: r.role, status: r.status }),
    createdAt: r.createdAt.toISOString(),
    actorUserId: r.invitedByUserId,
  }));
}

async function collectQuotaEvents(
  workspaceId: string, since: Date, limit: number
): Promise<ActivityEvent[]> {
  const rows = await prisma.workspaceQuotaEvent.findMany({
    where: { workspaceId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: `quota-${r.id}`,
    category: "quota" as ActivityCategory,
    action: "quota_exceeded",
    severity: "warning" as ActivitySeverity,
    title: `Quota exceeded: ${r.resource}`,
    summary: `Resource ${r.resource} reached limit ${r.limit ?? "∞"} (used: ${r.used})`,
    metadata: safeMetadata({
      resource: r.resource,
      limit: r.limit,
      used: r.used,
      attemptedIncrement: r.attemptedIncrement,
      source: r.source,
    }),
    createdAt: r.createdAt.toISOString(),
    actorUserId: r.actorUserId,
  }));
}

async function collectNotificationEvents(
  workspaceId: string, since: Date, limit: number
): Promise<ActivityEvent[]> {
  // Notifications are user-scoped, so we get them via workspace memberships
  const memberIds = await prisma.workspaceMembership.findMany({
    where: { workspaceId, status: "active" },
    select: { userId: true },
  });
  const userIds = memberIds.map((m) => m.userId);
  if (userIds.length === 0) return [];

  const rows = await prisma.notificationEvent.findMany({
    where: { userId: { in: userIds }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, kind: true, title: true, severity: true,
      createdAt: true, userId: true,
    },
  });
  return rows.map((r) => ({
    id: `notification-${r.id}`,
    category: "notification" as ActivityCategory,
    action: r.kind,
    severity: (r.severity === "critical" ? "critical" : r.severity === "warning" ? "warning" : "info") as ActivitySeverity,
    title: safeTruncate(r.title),
    summary: `Notification: ${safeTruncate(r.kind)}`,
    createdAt: r.createdAt.toISOString(),
    actorUserId: r.userId,
  }));
}

async function collectSchedulerEvents(
  _workspaceId: string, since: Date, limit: number
): Promise<ActivityEvent[]> {
  const rows = await prisma.schedulerRunStatus.findMany({
    where: { updatedAt: { gte: since } },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: `scheduler-${r.name}-${r.updatedAt.getTime()}`,
    category: "scheduler" as ActivityCategory,
    action: r.lastStatus ?? "unknown",
    severity: (r.lastStatus === "failed" ? "error" : "info") as ActivitySeverity,
    title: `Scheduler: ${r.name}`,
    summary: `Status: ${r.lastStatus ?? "unknown"}, runs: ${r.runCount}, failures: ${r.failureCount}`,
    metadata: safeMetadata({
      enabled: r.enabled,
      runCount: r.runCount,
      failureCount: r.failureCount,
      skippedCount: r.skippedCount,
    }),
    createdAt: r.updatedAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function getWorkspaceActivityTimeline(params: {
  actorUserId: string;
  workspaceId: string;
  range: ActivityRange;
  cursor?: string;
  limit?: number;
  filters?: { categories?: ActivityCategory[] };
}): Promise<ActivityTimelineResult> {
  const { workspaceId, range, limit: rawLimit, filters } = params;
  const limit = Math.min(Math.max(rawLimit ?? 50, 1), 200);
  const since = rangeToDate(range);

  const categories = filters?.categories?.length
    ? filters.categories.filter((c) => ACTIVITY_CATEGORIES.includes(c))
    : ACTIVITY_CATEGORIES;

  // Collect events from each requested category in parallel
  const collectors: Promise<ActivityEvent[]>[] = [];
  const perSourceLimit = limit * 2; // fetch more to allow merging

  if (categories.includes("membership")) collectors.push(collectMembershipEvents(workspaceId, since, perSourceLimit));
  if (categories.includes("invite")) collectors.push(collectInviteEvents(workspaceId, since, perSourceLimit));
  if (categories.includes("quota")) collectors.push(collectQuotaEvents(workspaceId, since, perSourceLimit));
  if (categories.includes("notification")) collectors.push(collectNotificationEvents(workspaceId, since, perSourceLimit));
  if (categories.includes("scheduler")) collectors.push(collectSchedulerEvents(workspaceId, since, perSourceLimit));

  const results = await Promise.all(collectors);
  let allEvents = results.flat();

  // Apply cursor filter
  if (params.cursor) {
    const cursorDate = new Date(params.cursor);
    if (!isNaN(cursorDate.getTime())) {
      allEvents = allEvents.filter((e) => new Date(e.createdAt) < cursorDate);
    }
  }

  // Sort by createdAt desc
  allEvents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Paginate
  const page = allEvents.slice(0, limit);
  const nextCursor = page.length === limit && page.length > 0
    ? page[page.length - 1].createdAt
    : undefined;

  return { events: page, nextCursor };
}
