import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import type { NotificationEvent } from "@prisma/client";
import type { WorkspaceNotification, NotificationEventView, ProviderId } from "@uaiw/shared/types/provider.js";

export function sanitizeNotificationMetadata(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) return {};

  const allowedKeys = new Set([
    "provider",
    "modelId",
    "source",
    "limitType",
    "limitPerMinute",
    "hits24h",
    "threshold24h",
    "range",
    "status",
    "errorCode"
  ]);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowedKeys.has(key)) {
      result[key] = value;
    }
  }

  return result;
}

function mapToView(event: NotificationEvent): NotificationEventView {
  return {
    id: event.id,
    kind: event.kind as WorkspaceNotification["kind"],
    severity: event.severity as WorkspaceNotification["severity"],
    title: event.title,
    message: event.message,
    provider: (event.provider as ProviderId) ?? undefined,
    modelId: event.modelId,
    action:
      event.actionLabel && event.actionHref
        ? { label: event.actionLabel, href: event.actionHref }
        : undefined,
    readAt: event.readAt ? event.readAt.toISOString() : null,
    createdAt: event.createdAt.toISOString(),
    fingerprint: event.fingerprint
  };
}

export async function materializeNotificationEvent(
  userId: string,
  notification: WorkspaceNotification,
  options?: { updateExisting?: boolean }
): Promise<NotificationEventView> {
  const existing = await prisma.notificationEvent.findUnique({
    where: {
      userId_fingerprint: {
        userId,
        fingerprint: notification.fingerprint
      }
    }
  });

  if (existing) {
    if (options?.updateExisting) {
      const updated = await prisma.notificationEvent.update({
        where: { id: existing.id },
        data: {
          title: notification.title,
          message: notification.message,
          severity: notification.severity,
          actionLabel: notification.action?.label,
          actionHref: notification.action?.href
        }
      });
      return mapToView(updated);
    }
    return mapToView(existing);
  }

  const created = await prisma.notificationEvent.create({
    data: {
      userId,
      kind: notification.kind,
      severity: notification.severity,
      title: notification.title,
      message: notification.message,
      provider: notification.provider,
      modelId: notification.modelId,
      fingerprint: notification.fingerprint,
      actionLabel: notification.action?.label,
      actionHref: notification.action?.href
    }
  });

  return mapToView(created);
}

export async function materializeNotificationEvents(
  userId: string,
  notifications: WorkspaceNotification[]
): Promise<NotificationEventView[]> {
  const results: NotificationEventView[] = [];
  for (const notification of notifications) {
    results.push(await materializeNotificationEvent(userId, notification));
  }
  return results;
}

export async function listNotificationEvents(input: {
  userId: string;
  limit?: number;
  unreadOnly?: boolean;
  kind?: string;
}): Promise<{
  events: NotificationEventView[];
  unreadCount: number;
}> {
  const { userId, limit = 50, unreadOnly, kind } = input;

  const where: any = { userId };
  if (unreadOnly) {
    where.readAt = null;
  }
  if (kind) {
    where.kind = kind;
  }

  const [events, unreadCount] = await Promise.all([
    prisma.notificationEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit
    }),
    prisma.notificationEvent.count({
      where: { userId, readAt: null }
    })
  ]);

  return {
    events: events.map(mapToView),
    unreadCount
  };
}

export async function markNotificationEventRead(
  userId: string,
  eventId: string
): Promise<NotificationEventView> {
  const event = await prisma.notificationEvent.findUnique({
    where: { id: eventId }
  });

  if (!event || event.userId !== userId) {
    throw new Error("NOT_FOUND");
  }

  if (event.readAt) {
    return mapToView(event);
  }

  const updated = await prisma.notificationEvent.update({
    where: { id: eventId },
    data: { readAt: new Date() }
  });

  return mapToView(updated);
}

export async function markAllNotificationEventsRead(
  userId: string
): Promise<{ updated: number }> {
  const result = await prisma.notificationEvent.updateMany({
    where: {
      userId,
      readAt: null
    },
    data: {
      readAt: new Date()
    }
  });

  return { updated: result.count };
}

export interface NotificationCleanupInput {
  userId?: string;
  olderThanDays?: number;
  before?: Date;
  dryRun?: boolean;
}

export interface NotificationCleanupResult {
  dryRun: boolean;
  retentionDays?: number;
  cutoffDate: string;
  matchedCount: number;
  deletedCount: number;
}

export async function deleteOldNotificationEvents(
  input: NotificationCleanupInput
): Promise<NotificationCleanupResult> {
  const dryRun = input.dryRun ?? false;

  let cutoffDate: Date;
  let retentionDays: number | undefined = undefined;

  if (input.before) {
    if (isNaN(input.before.getTime())) {
      throw new Error("Invalid 'before' date provided.");
    }
    cutoffDate = input.before;
  } else {
    retentionDays = input.olderThanDays ?? env.NOTIFICATION_EVENT_RETENTION_DAYS;
    if (typeof retentionDays !== 'number' || isNaN(retentionDays) || retentionDays < 0) {
      throw new Error("Retention days must be a positive number.");
    }
    cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  }

  const where: any = {
    createdAt: { lt: cutoffDate }
  };
  if (input.userId) {
    where.userId = input.userId;
  }

  const matchedCount = await prisma.notificationEvent.count({ where });

  let deletedCount = 0;
  if (!dryRun) {
    const result = await prisma.notificationEvent.deleteMany({ where });
    deletedCount = result.count;
  }

  return {
    dryRun,
    retentionDays,
    cutoffDate: cutoffDate.toISOString(),
    matchedCount,
    deletedCount
  };
}
