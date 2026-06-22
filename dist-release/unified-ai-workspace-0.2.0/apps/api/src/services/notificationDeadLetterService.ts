import { prisma } from "./prisma.js";
import { enqueueWebhookDeliveryRetry } from "./notificationWebhookRetryQueue.js";
import type { NotificationDeliveryChannel } from "@uaiw/shared/types/provider.js";

export type DeadLetterStatus = "open" | "resolved";

export async function createOrUpdateDeadLetter(input: {
  userId: string;
  notificationEventId: string;
  deliveryAttemptId?: string;
  channel: NotificationDeliveryChannel;
  reason: string;
  failureCode?: string | null;
  retryable: boolean;
  metadata?: Record<string, unknown>;
  firstFailedAt?: Date;
}) {
  const existing = await prisma.notificationDeadLetter.findFirst({
    where: {
      userId: input.userId,
      notificationEventId: input.notificationEventId,
      channel: input.channel
    }
  });

  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

  if (existing) {
    return prisma.notificationDeadLetter.update({
      where: { id: existing.id },
      data: {
        deliveryAttemptId: input.deliveryAttemptId,
        reason: input.reason,
        failureCode: input.failureCode,
        retryable: input.retryable,
        metadataJson,
        deadLetteredAt: new Date(),
        status: "open",
        resolvedAt: null
      }
    });
  }

  return prisma.notificationDeadLetter.create({
    data: {
      userId: input.userId,
      notificationEventId: input.notificationEventId,
      deliveryAttemptId: input.deliveryAttemptId,
      channel: input.channel,
      reason: input.reason,
      failureCode: input.failureCode,
      retryable: input.retryable,
      metadataJson,
      firstFailedAt: input.firstFailedAt ?? new Date(),
      status: "open"
    }
  });
}

export async function resolveDeadLetter(id: string, userId: string, resolutionNote?: string) {
  const dlq = await prisma.notificationDeadLetter.findUnique({ where: { id } });
  if (!dlq || dlq.userId !== userId) {
    throw new Error("Dead letter not found");
  }

  return prisma.notificationDeadLetter.update({
    where: { id },
    data: {
      status: "resolved",
      resolvedAt: new Date(),
      metadataJson: resolutionNote 
        ? JSON.stringify({ ...JSON.parse(dlq.metadataJson || "{}"), resolutionNote })
        : dlq.metadataJson
    }
  });
}

export async function retryDeadLetter(id: string, userId: string) {
  const dlq = await prisma.notificationDeadLetter.findUnique({ where: { id } });
  if (!dlq || dlq.userId !== userId) {
    throw new Error("Dead letter not found");
  }

  if (dlq.channel !== "webhook") {
    throw new Error("Only webhook dead letters can be retried");
  }

  if (!dlq.retryable) {
    throw new Error("Dead letter is not marked as retryable");
  }

  // Find the max attempt number
  const latestAttempt = await prisma.notificationDeliveryAttempt.findFirst({
    where: {
      userId,
      notificationEventId: dlq.notificationEventId,
      channel: dlq.channel
    },
    orderBy: { attemptNumber: "desc" }
  });

  const nextAttemptNumber = (latestAttempt?.attemptNumber ?? 0) + 1;

  const { jobId } = await enqueueWebhookDeliveryRetry({
    userId,
    notificationEventId: dlq.notificationEventId,
    delayMs: 0,
    attemptNumber: nextAttemptNumber,
    reason: "manual_retry_dlq"
  });

  await prisma.notificationDeadLetter.update({
    where: { id },
    data: {
      lastRetryAt: new Date(),
      retryCount: { increment: 1 }
    }
  });

  return { queued: true, jobId, notificationEventId: dlq.notificationEventId };
}

export async function listDeadLetters(userId: string, options?: {
  status?: string;
  limit?: number;
}) {
  const limit = options?.limit ?? 50;
  
  const records = await prisma.notificationDeadLetter.findMany({
    where: {
      userId,
      ...(options?.status && options.status !== "all" ? { status: options.status } : {})
    },
    orderBy: { deadLetteredAt: "desc" },
    take: limit,
    include: {
      notificationEvent: {
        select: {
          kind: true,
          title: true,
          severity: true
        }
      }
    }
  });

  return records.map(r => ({
    id: r.id,
    notificationEventId: r.notificationEventId,
    deliveryAttemptId: r.deliveryAttemptId,
    kind: r.notificationEvent.kind,
    eventTitle: r.notificationEvent.title,
    eventSeverity: r.notificationEvent.severity,
    channel: r.channel,
    status: r.status,
    reason: r.reason,
    failureCode: r.failureCode,
    retryable: r.retryable,
    retryCount: r.retryCount,
    firstFailedAt: r.firstFailedAt.toISOString(),
    deadLetteredAt: r.deadLetteredAt.toISOString(),
    lastRetryAt: r.lastRetryAt?.toISOString() ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null
  }));
}

export async function getDeadLetterDetails(id: string, userId: string) {
  const dlq = await prisma.notificationDeadLetter.findUnique({
    where: { id },
    include: {
      notificationEvent: true,
      deliveryAttempt: true
    }
  });

  if (!dlq || dlq.userId !== userId) {
    return null;
  }

  // Safe subset
  return {
    id: dlq.id,
    notificationEventId: dlq.notificationEventId,
    deliveryAttemptId: dlq.deliveryAttemptId,
    channel: dlq.channel,
    status: dlq.status,
    reason: dlq.reason,
    failureCode: dlq.failureCode,
    retryable: dlq.retryable,
    retryCount: dlq.retryCount,
    firstFailedAt: dlq.firstFailedAt.toISOString(),
    deadLetteredAt: dlq.deadLetteredAt.toISOString(),
    lastRetryAt: dlq.lastRetryAt?.toISOString() ?? null,
    resolvedAt: dlq.resolvedAt?.toISOString() ?? null,
    eventSummary: {
      id: dlq.notificationEvent.id,
      kind: dlq.notificationEvent.kind,
      title: dlq.notificationEvent.title,
      severity: dlq.notificationEvent.severity,
      createdAt: dlq.notificationEvent.createdAt.toISOString()
    },
    latestAttempt: dlq.deliveryAttempt ? {
      id: dlq.deliveryAttempt.id,
      status: dlq.deliveryAttempt.status,
      errorCode: dlq.deliveryAttempt.errorCode,
      attemptNumber: dlq.deliveryAttempt.attemptNumber,
      attemptedAt: dlq.deliveryAttempt.attemptedAt.toISOString()
    } : null
  };
}

export async function reconcileDeadLetters(userId: string) {
  // Find failed attempts with no active retry job that aren't already dead-lettered
  const lookbackDays = 7;
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  const attempts = await prisma.notificationDeliveryAttempt.findMany({
    where: {
      userId,
      status: "failed",
      attemptedAt: { gte: since },
      nextRetryAt: null, // no scheduled retry
      deadLetters: { none: {} } // no associated dead-letter record
    },
    orderBy: { attemptedAt: "desc" },
    take: 100
  });

  let created = 0;

  for (const attempt of attempts) {
    // Only process the latest attempt for each event-channel pair to avoid duplicate DLQs
    const latestAttempt = await prisma.notificationDeliveryAttempt.findFirst({
      where: {
        userId,
        notificationEventId: attempt.notificationEventId,
        channel: attempt.channel
      },
      orderBy: { attemptNumber: "desc" }
    });

    if (latestAttempt?.id !== attempt.id) {
      continue;
    }

    await createOrUpdateDeadLetter({
      userId,
      notificationEventId: attempt.notificationEventId,
      deliveryAttemptId: attempt.id,
      channel: attempt.channel as NotificationDeliveryChannel,
      reason: attempt.errorCode || "unknown_failure",
      failureCode: attempt.errorCode,
      retryable: attempt.retryable,
      firstFailedAt: attempt.attemptedAt
    });
    created++;
  }

  return { created, skipped: attempts.length - created };
}
