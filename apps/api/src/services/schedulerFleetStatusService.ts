import { env } from "../config/env.js";
import { listSchedulerStatuses, type SchedulerStatusView } from "./schedulerStatusService.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulerFleetEntry {
  name: string;
  enabled: boolean;
  lastStatus?: string;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  runCount: number;
  failureCount: number;
  skippedCount: number;
  lastSummary?: Record<string, string | number | boolean | null>;
}

export interface SchedulerFleetStatusDTO {
  schedulers: SchedulerFleetEntry[];
}

// ---------------------------------------------------------------------------
// Known schedulers
// ---------------------------------------------------------------------------

const KNOWN_SCHEDULERS: Array<{ name: string; enabledKey: keyof typeof env }> = [
  { name: "provider_health", enabledKey: "PROVIDER_HEALTH_SCHEDULER_ENABLED" },
  { name: "workspace_invite_expiry", enabledKey: "WORKSPACE_INVITE_EXPIRY_SCHEDULER_ENABLED" },
  { name: "workspace_quota_alerts", enabledKey: "WORKSPACE_QUOTA_ALERT_SCHEDULER_ENABLED" },
];

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function getSchedulerFleetStatus(): Promise<SchedulerFleetStatusDTO> {
  const dbStatuses = await listSchedulerStatuses();
  const statusMap = new Map<string, SchedulerStatusView>();
  for (const s of dbStatuses) {
    statusMap.set(s.name, s);
  }

  const schedulers: SchedulerFleetEntry[] = [];

  // Include known schedulers even if they haven't run yet
  for (const known of KNOWN_SCHEDULERS) {
    const db = statusMap.get(known.name);
    const enabled = Boolean(env[known.enabledKey]);

    schedulers.push({
      name: known.name,
      enabled,
      lastStatus: db?.lastStatus,
      lastStartedAt: db?.lastStartedAt,
      lastFinishedAt: db?.lastFinishedAt,
      runCount: db?.runCount ?? 0,
      failureCount: db?.failureCount ?? 0,
      skippedCount: db?.skippedCount ?? 0,
      lastSummary: db?.lastSummary as Record<string, string | number | boolean | null> | undefined,
    });

    statusMap.delete(known.name);
  }

  // Include any extra schedulers from DB that aren't in the known list
  for (const [, db] of statusMap) {
    schedulers.push({
      name: db.name,
      enabled: db.enabled,
      lastStatus: db.lastStatus,
      lastStartedAt: db.lastStartedAt,
      lastFinishedAt: db.lastFinishedAt,
      runCount: db.runCount,
      failureCount: db.failureCount,
      skippedCount: db.skippedCount,
      lastSummary: db.lastSummary as Record<string, string | number | boolean | null> | undefined,
    });
  }

  return { schedulers };
}
