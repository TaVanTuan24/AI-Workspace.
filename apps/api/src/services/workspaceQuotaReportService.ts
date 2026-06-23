import { prisma } from "./prisma.js";
import { getWorkspaceUsageSummary } from "./workspaceQuotaService.js";

export type QuotaReportRange = "24h" | "7d" | "30d" | "90d";

export interface QuotaReportInput {
  actorUserId: string;
  workspaceId: string;
  range: QuotaReportRange;
}

export interface WorkspaceQuotaReportView {
  workspace: {
    id: string;
    name: string;
    slug?: string;
  };
  range: QuotaReportRange;
  generatedAt: string;
  quotas: Array<{
    resource: string;
    limit: number | null;
    used: number;
    remaining: number | null;
    exceeded: boolean;
  }>;
  eventsByResource: Array<{
    resource: string;
    count: number;
  }>;
  eventsBySource: Array<{
    source: string;
    count: number;
  }>;
  recentEvents: Array<{
    resource: string;
    source: string;
    limit: number | null;
    used: number;
    attemptedIncrement: number;
    createdAt: string;
  }>;
}

export async function getWorkspaceQuotaReport(input: QuotaReportInput): Promise<WorkspaceQuotaReportView> {
  const { workspaceId, range } = input;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, slug: true }
  });

  if (!workspace) {
    throw new Error("Workspace not found");
  }

  const rangeHours = {
    "24h": 24,
    "7d": 24 * 7,
    "30d": 24 * 30,
    "90d": 24 * 90
  }[range];

  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - rangeHours);

  const summary = await getWorkspaceUsageSummary({ workspaceId });

  const rawEvents = await prisma.workspaceQuotaEvent.findMany({
    where: {
      workspaceId,
      createdAt: {
        gte: cutoff
      }
    },
    orderBy: { createdAt: "desc" }
  });

  const eventsByResourceMap = new Map<string, number>();
  const eventsBySourceMap = new Map<string, number>();

  for (const event of rawEvents) {
    eventsByResourceMap.set(event.resource, (eventsByResourceMap.get(event.resource) || 0) + 1);
    eventsBySourceMap.set(event.source, (eventsBySourceMap.get(event.source) || 0) + 1);
  }

  const eventsByResource = Array.from(eventsByResourceMap.entries()).map(([resource, count]) => ({ resource, count }));
  const eventsBySource = Array.from(eventsBySourceMap.entries()).map(([source, count]) => ({ source, count }));

  eventsByResource.sort((a, b) => b.count - a.count);
  eventsBySource.sort((a, b) => b.count - a.count);

  const recentEvents = rawEvents.slice(0, 100).map((e) => ({
    resource: e.resource,
    source: e.source,
    limit: e.limit,
    used: e.used,
    attemptedIncrement: e.attemptedIncrement,
    createdAt: e.createdAt.toISOString()
  }));

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug
    },
    range,
    generatedAt: new Date().toISOString(),
    quotas: summary.quotas,
    eventsByResource,
    eventsBySource,
    recentEvents
  };
}
