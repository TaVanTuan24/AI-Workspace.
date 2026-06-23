import { prisma } from "./prisma.js";

export const PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME = "provider_recovery_override_expiry";
export const WORKSPACE_INVITE_EXPIRY_SCHEDULER_NAME = "workspace_invite_expiry";

export type SchedulerLastStatus = "running" | "success" | "failed" | "skipped" | "disabled";

export interface SchedulerSafeSummary {
  scanned?: number;
  scannedWorkspaces?: number;
  expired?: number;
  warningsCreated?: number;
  exceededCreated?: number;
  skipped?: number;
  dryRun?: boolean;
  durationMs?: number;
  lock?: "acquired" | "skipped" | "unavailable";
  source?: "scheduler" | "cli";
}

export interface SchedulerStatusView {
  name: string;
  enabled: boolean;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastStatus?: SchedulerLastStatus;
  lastError?: string;
  lastLockAcquired?: boolean;
  lastSummary?: SchedulerSafeSummary;
  runCount: number;
  failureCount: number;
  skippedCount: number;
  updatedAt?: string;
}

export async function recordSchedulerStarted(input: {
  name: string;
  enabled: boolean;
  lockAcquired?: boolean;
}): Promise<void> {
  await safeRecord(async () => {
    await prisma.schedulerRunStatus.upsert({
      where: { name: input.name },
      create: {
        name: input.name,
        enabled: input.enabled,
        lastStartedAt: new Date(),
        lastStatus: "running",
        lastLockAcquired: input.lockAcquired ?? null
      },
      update: {
        enabled: input.enabled,
        lastStartedAt: new Date(),
        lastStatus: "running",
        lastError: null,
        lastLockAcquired: input.lockAcquired ?? null
      }
    });
  });
}

export async function recordSchedulerFinished(input: {
  name: string;
  enabled: boolean;
  status?: "success";
  lockAcquired?: boolean;
  summary?: SchedulerSafeSummary;
}): Promise<void> {
  const summary = sanitizeSummary(input.summary);
  await safeRecord(async () => {
    await prisma.schedulerRunStatus.upsert({
      where: { name: input.name },
      create: {
        name: input.name,
        enabled: input.enabled,
        lastFinishedAt: new Date(),
        lastStatus: input.status ?? "success",
        lastLockAcquired: input.lockAcquired ?? null,
        lastSummary: JSON.stringify(summary),
        runCount: 1
      },
      update: {
        enabled: input.enabled,
        lastFinishedAt: new Date(),
        lastStatus: input.status ?? "success",
        lastError: null,
        lastLockAcquired: input.lockAcquired ?? null,
        lastSummary: JSON.stringify(summary),
        runCount: { increment: 1 }
      }
    });
  });
}

export async function recordSchedulerSkipped(input: {
  name: string;
  enabled: boolean;
  reason?: string;
  lockAcquired?: boolean;
  status?: "skipped" | "disabled";
  summary?: SchedulerSafeSummary;
}): Promise<void> {
  const summary = sanitizeSummary(input.summary);
  await safeRecord(async () => {
    await prisma.schedulerRunStatus.upsert({
      where: { name: input.name },
      create: {
        name: input.name,
        enabled: input.enabled,
        lastFinishedAt: new Date(),
        lastStatus: input.status ?? "skipped",
        lastError: sanitizeError(input.reason),
        lastLockAcquired: input.lockAcquired ?? false,
        lastSummary: JSON.stringify(summary),
        runCount: 1,
        skippedCount: 1
      },
      update: {
        enabled: input.enabled,
        lastFinishedAt: new Date(),
        lastStatus: input.status ?? "skipped",
        lastError: sanitizeError(input.reason),
        lastLockAcquired: input.lockAcquired ?? false,
        lastSummary: JSON.stringify(summary),
        runCount: { increment: 1 },
        skippedCount: { increment: 1 }
      }
    });
  });
}

export async function recordSchedulerFailed(input: {
  name: string;
  enabled: boolean;
  error: unknown;
  lockAcquired?: boolean;
  summary?: SchedulerSafeSummary;
}): Promise<void> {
  const summary = sanitizeSummary(input.summary);
  await safeRecord(async () => {
    await prisma.schedulerRunStatus.upsert({
      where: { name: input.name },
      create: {
        name: input.name,
        enabled: input.enabled,
        lastFinishedAt: new Date(),
        lastStatus: "failed",
        lastError: sanitizeError(input.error),
        lastLockAcquired: input.lockAcquired ?? null,
        lastSummary: JSON.stringify(summary),
        runCount: 1,
        failureCount: 1
      },
      update: {
        enabled: input.enabled,
        lastFinishedAt: new Date(),
        lastStatus: "failed",
        lastError: sanitizeError(input.error),
        lastLockAcquired: input.lockAcquired ?? null,
        lastSummary: JSON.stringify(summary),
        runCount: { increment: 1 },
        failureCount: { increment: 1 }
      }
    });
  });
}

export async function getSchedulerStatus(name: string): Promise<SchedulerStatusView | null> {
  const row = await prisma.schedulerRunStatus.findUnique({ where: { name } });
  return row ? toSchedulerStatusView(row) : null;
}

export async function listSchedulerStatuses(): Promise<SchedulerStatusView[]> {
  const rows = await prisma.schedulerRunStatus.findMany({ orderBy: { name: "asc" } });
  return rows.map(toSchedulerStatusView);
}

export function sanitizeSchedulerError(error: unknown): string | undefined {
  return sanitizeError(error);
}

export function sanitizeSchedulerSummary(input?: SchedulerSafeSummary): SchedulerSafeSummary {
  return sanitizeSummary(input);
}

function toSchedulerStatusView(row: {
  name: string;
  enabled: boolean;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  lastLockAcquired: boolean | null;
  lastSummary: string | null;
  runCount: number;
  failureCount: number;
  skippedCount: number;
  updatedAt: Date;
}): SchedulerStatusView {
  return {
    name: row.name,
    enabled: row.enabled,
    lastStartedAt: row.lastStartedAt?.toISOString(),
    lastFinishedAt: row.lastFinishedAt?.toISOString(),
    lastStatus: parseStatus(row.lastStatus),
    lastError: row.lastError ?? undefined,
    lastLockAcquired: row.lastLockAcquired ?? undefined,
    lastSummary: parseSummary(row.lastSummary),
    runCount: row.runCount,
    failureCount: row.failureCount,
    skippedCount: row.skippedCount,
    updatedAt: row.updatedAt.toISOString()
  };
}

function parseStatus(status?: string | null): SchedulerLastStatus | undefined {
  return status === "running" || status === "success" || status === "failed" || status === "skipped" || status === "disabled"
    ? status
    : undefined;
}

function parseSummary(value?: string | null): SchedulerSafeSummary | undefined {
  if (!value) return undefined;
  try {
    return sanitizeSummary(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function sanitizeSummary(input?: SchedulerSafeSummary): SchedulerSafeSummary {
  const source = input?.source === "cli" ? "cli" : input?.source === "scheduler" ? "scheduler" : undefined;
  const lock = input?.lock === "acquired" || input?.lock === "skipped" || input?.lock === "unavailable" ? input.lock : undefined;
  return {
    ...(safeNumber(input?.scanned) !== undefined ? { scanned: safeNumber(input?.scanned) } : {}),
    ...(safeNumber(input?.scannedWorkspaces) !== undefined ? { scannedWorkspaces: safeNumber(input?.scannedWorkspaces) } : {}),
    ...(safeNumber(input?.expired) !== undefined ? { expired: safeNumber(input?.expired) } : {}),
    ...(safeNumber(input?.warningsCreated) !== undefined ? { warningsCreated: safeNumber(input?.warningsCreated) } : {}),
    ...(safeNumber(input?.exceededCreated) !== undefined ? { exceededCreated: safeNumber(input?.exceededCreated) } : {}),
    ...(safeNumber(input?.skipped) !== undefined ? { skipped: safeNumber(input?.skipped) } : {}),
    ...(typeof input?.dryRun === "boolean" ? { dryRun: input.dryRun } : {}),
    ...(safeNumber(input?.durationMs) !== undefined ? { durationMs: safeNumber(input?.durationMs) } : {}),
    ...(lock ? { lock } : {}),
    ...(source ? { source } : {})
  };
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function sanitizeError(error: unknown): string | undefined {
  if (!error) return undefined;
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/redis:\/\/[^\s"'<>]+/gi, "redis://[redacted]")
    .replace(/rediss:\/\/[^\s"'<>]+/gi, "rediss://[redacted]")
    .replace(/(api[_-]?key|token|password|secret|signature|webhook)(\s*[=:]\s*)[^\s"'<>]+/gi, "$1$2[redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return redacted || undefined;
}

async function safeRecord(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const message = sanitizeError(error) ?? "unknown scheduler status persistence error";
    console.warn(`Scheduler status persistence skipped: ${message}`);
  }
}
