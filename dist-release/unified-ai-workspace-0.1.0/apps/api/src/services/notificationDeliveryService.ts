import { prisma } from "./prisma.js";
import type { 
  NotificationEventView,
  NotificationDeliveryAttemptView,
  NotificationDeliveryChannel,
  NotificationDeliveryStatus
} from "@uaiw/shared/types/provider.js";
import { getNotificationDeliveryPreferences } from "./notificationDeliveryPreferenceService.js";
import { decryptSecretString } from "./secretBoxService.js";
import { createHmac } from "node:crypto";
import { env } from "../config/env.js";
import { enqueueWebhookDeliveryRetry } from "./notificationWebhookRetryQueue.js";

interface SafeNotificationDeliveryPayload {
  eventId: string;
  kind: string;
  severity: string;
  title: string;
  message: string;
  provider?: string | null;
  modelId?: string | null;
  actionHref?: string | null;
  userId: string;
}

interface NotificationChannelProvider {
  channel: NotificationDeliveryChannel;
  deliver(input: SafeNotificationDeliveryPayload, pref: any): Promise<{
    status: NotificationDeliveryStatus;
    errorCode?: string;
    metadata?: Record<string, unknown>;
  }>;
}

const IN_APP_PROVIDER: NotificationChannelProvider = {
  channel: "in_app",
  async deliver() {
    return { status: "delivered" };
  }
};

const EMAIL_NOOP_PROVIDER: NotificationChannelProvider = {
  channel: "email_noop",
  async deliver() {
    return { status: "skipped_not_configured" };
  }
};

const SLACK_NOOP_PROVIDER: NotificationChannelProvider = {
  channel: "slack_noop",
  async deliver() {
    return { status: "skipped_not_configured" };
  }
};

const WEBHOOK_NOOP_PROVIDER: NotificationChannelProvider = {
  channel: "webhook_noop",
  async deliver() {
    return { status: "skipped_not_configured" };
  }
};

const WEBHOOK_PROVIDER: NotificationChannelProvider = {
  channel: "webhook",
  async deliver(input, pref) {
    if (!pref.config?.urlPreview || !pref.config?.hasSigningSecret) {
      return { status: "skipped_not_configured" };
    }

    const record = await prisma.notificationDeliveryPreference.findUnique({
      where: { userId_channel: { userId: input.userId, channel: "webhook" } }
    });
    
    // Fallback if record somehow doesn't exist
    if (!record?.configJson) return { status: "skipped_not_configured" };
    
    const config = JSON.parse(record.configJson);
    if (!config.url || !config.encryptedSigningSecret) {
      return { status: "skipped_not_configured" };
    }

    let secret: string;
    try {
      secret = decryptSecretString(config.encryptedSigningSecret);
    } catch {
      return { status: "failed", errorCode: "secret_decryption_failed" };
    }

    const payload = {
      id: input.eventId,
      type: input.kind === "test_webhook" ? "test.event" : "notification.event",
      createdAt: new Date().toISOString(),
      notification: {
        kind: input.kind,
        severity: input.severity,
        title: input.title,
        message: input.message,
        provider: input.provider,
        modelId: input.modelId,
        actionHref: input.actionHref
      }
    };

    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), env.NOTIFICATION_WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UAIW-Event-Id": input.eventId,
          "X-UAIW-Timestamp": timestamp,
          "X-UAIW-Signature": `sha256=${signature}`,
          "User-Agent": "UnifiedAIWorkspace/0.1.0"
        },
        body: rawBody,
        signal: controller.signal,
        redirect: "error"
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { 
          status: "failed", 
          errorCode: `http_${response.status}`,
          metadata: { statusCode: response.status }
        };
      }

      return { status: "delivered", metadata: { statusCode: response.status } };
    } catch (err: any) {
      clearTimeout(timeoutId);
      return {
        status: "failed",
        errorCode: err.name === "AbortError" ? "timeout" : "network_error",
        metadata: { error: err.message }
      };
    }
  }
};

const PROVIDERS: Record<NotificationDeliveryChannel, NotificationChannelProvider> = {
  in_app: IN_APP_PROVIDER,
  email_noop: EMAIL_NOOP_PROVIDER,
  slack_noop: SLACK_NOOP_PROVIDER,
  webhook_noop: WEBHOOK_NOOP_PROVIDER,
  webhook: WEBHOOK_PROVIDER
};

export function isRetryableError(errorCode: string | null | undefined): boolean {
  if (!errorCode) return false;
  if (errorCode === "timeout" || errorCode === "network_error" || errorCode === "delivery_provider_error") return true;
  if (errorCode.startsWith("http_")) {
    const status = parseInt(errorCode.replace("http_", ""), 10);
    return status === 429 || status >= 500;
  }
  return false;
}

export function computeNextRetryDelayMs(attemptNumber: number): number | null {
  if (!env.NOTIFICATION_WEBHOOK_RETRY_ENABLED) return null;
  if (attemptNumber >= env.NOTIFICATION_WEBHOOK_RETRY_MAX_ATTEMPTS) return null;

  const delay = Math.min(
    env.NOTIFICATION_WEBHOOK_RETRY_BASE_DELAY_MS * Math.pow(2, attemptNumber - 1),
    env.NOTIFICATION_WEBHOOK_RETRY_MAX_DELAY_MS
  );
  
  // Add jitter 0.8 - 1.2
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.floor(delay * jitter);
}

export async function deliverNotificationEvent(
  userId: string,
  event: NotificationEventView
): Promise<NotificationDeliveryAttemptView[]> {
  const prefs = await getNotificationDeliveryPreferences(userId);
  
  const payload: SafeNotificationDeliveryPayload = {
    eventId: event.id,
    userId,
    kind: event.kind,
    severity: event.severity,
    title: event.title,
    message: event.message,
    provider: event.provider,
    modelId: event.modelId,
    actionHref: event.action?.href
  };

  const attempts: NotificationDeliveryAttemptView[] = [];

  for (const pref of prefs) {
    if (!pref.enabled) {
      continue;
    }

    const provider = PROVIDERS[pref.channel];
    if (!provider) continue;

    // Attach userId onto input for specific providers like webhook which need to lookup config
    const deliveryInput = { ...payload, userId };

    try {
      const result = await provider.deliver(deliveryInput, pref);
      
      let retryable = false;
      let nextRetryAt: Date | null = null;
      let jobId: string | null = null;

      if (result.status === "failed" && isRetryableError(result.errorCode) && provider.channel === "webhook") {
        const delayMs = computeNextRetryDelayMs(1);
        if (delayMs !== null) {
          retryable = true;
          nextRetryAt = new Date(Date.now() + delayMs);
          const retryEnqueued = await enqueueWebhookDeliveryRetry({
            userId,
            notificationEventId: event.id,
            delayMs,
            attemptNumber: 2,
            reason: result.errorCode
          });
          jobId = retryEnqueued.jobId;
        }
      }

      const record = await prisma.notificationDeliveryAttempt.create({
        data: {
          userId,
          notificationEventId: event.id,
          channel: provider.channel,
          status: result.status,
          errorCode: result.errorCode,
          metadataJson: result.metadata ? JSON.stringify(result.metadata) : null,
          attemptNumber: 1,
          retryable,
          nextRetryAt,
          jobId
        }
      });

      attempts.push({
        id: record.id,
        notificationEventId: record.notificationEventId,
        channel: record.channel as NotificationDeliveryChannel,
        status: record.status as NotificationDeliveryStatus,
        errorCode: record.errorCode,
        attemptedAt: record.attemptedAt.toISOString(),
        attemptNumber: record.attemptNumber,
        retryable: record.retryable,
        nextRetryAt: record.nextRetryAt?.toISOString() ?? null
      });
    } catch (err) {
      // Catch all delivery errors to ensure main execution flow is not broken
      const record = await prisma.notificationDeliveryAttempt.create({
        data: {
          userId,
          notificationEventId: event.id,
          channel: provider.channel,
          status: "failed",
          errorCode: "delivery_provider_error",
          metadataJson: JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" })
        }
      }).catch(() => null);

      if (record) {
        attempts.push({
          id: record.id,
          notificationEventId: record.notificationEventId,
          channel: record.channel as NotificationDeliveryChannel,
          status: record.status as NotificationDeliveryStatus,
          errorCode: record.errorCode,
          attemptedAt: record.attemptedAt.toISOString(),
          attemptNumber: record.attemptNumber,
          retryable: record.retryable,
          nextRetryAt: record.nextRetryAt?.toISOString() ?? null
        });
      }
    }
  }

  return attempts;
}

export async function processWebhookRetry(input: {
  userId: string;
  notificationEventId: string;
  attemptNumber: number;
}): Promise<void> {
  const event = await prisma.notificationEvent.findUnique({
    where: { id: input.notificationEventId }
  });

  if (!event || event.userId !== input.userId) {
    return;
  }

  const prefs = await getNotificationDeliveryPreferences(input.userId);
  const pref = prefs.find(p => p.channel === "webhook");
  
  if (!pref || !pref.enabled) {
    await prisma.notificationDeliveryAttempt.create({
      data: {
        userId: input.userId,
        notificationEventId: event.id,
        channel: "webhook",
        status: "skipped_disabled",
        attemptNumber: input.attemptNumber,
      }
    });
    return;
  }

  const payload: SafeNotificationDeliveryPayload = {
    eventId: event.id,
    kind: event.kind,
    severity: event.severity,
    title: event.title,
    message: event.message,
    provider: event.provider,
    modelId: event.modelId,
    actionHref: event.actionHref,
    userId: input.userId
  };

  const result = await WEBHOOK_PROVIDER.deliver(payload, pref);

  let retryable = false;
  let nextRetryAt: Date | null = null;
  let jobId: string | null = null;

  if (result.status === "failed" && isRetryableError(result.errorCode)) {
    const delayMs = computeNextRetryDelayMs(input.attemptNumber);
    if (delayMs !== null) {
      retryable = true;
      nextRetryAt = new Date(Date.now() + delayMs);
      const retryEnqueued = await enqueueWebhookDeliveryRetry({
        userId: input.userId,
        notificationEventId: event.id,
        delayMs,
        attemptNumber: input.attemptNumber + 1,
        reason: result.errorCode
      });
      jobId = retryEnqueued.jobId;
    }
  }

  await prisma.notificationDeliveryAttempt.create({
    data: {
      userId: input.userId,
      notificationEventId: event.id,
      channel: "webhook",
      status: result.status,
      errorCode: result.errorCode,
      metadataJson: result.metadata ? JSON.stringify(result.metadata) : null,
      attemptNumber: input.attemptNumber,
      retryable,
      nextRetryAt,
      jobId
    }
  });
}

export async function listNotificationDeliveryAttempts(input: {
  userId: string;
  notificationEventId?: string;
  limit?: number;
}): Promise<NotificationDeliveryAttemptView[]> {
  const limit = input.limit ?? 50;

  const records = await prisma.notificationDeliveryAttempt.findMany({
    where: {
      userId: input.userId,
      ...(input.notificationEventId ? { notificationEventId: input.notificationEventId } : {})
    },
    orderBy: { attemptedAt: "desc" },
    take: limit
  });

  return records.map(r => ({
    id: r.id,
    notificationEventId: r.notificationEventId,
    channel: r.channel as NotificationDeliveryChannel,
    status: r.status as NotificationDeliveryStatus,
    errorCode: r.errorCode,
    attemptedAt: r.attemptedAt.toISOString(),
    attemptNumber: r.attemptNumber,
    retryable: r.retryable,
    nextRetryAt: r.nextRetryAt?.toISOString() ?? null
  }));
}
