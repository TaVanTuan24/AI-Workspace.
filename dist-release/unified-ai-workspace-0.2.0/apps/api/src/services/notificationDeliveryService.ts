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
import { createOrUpdateDeadLetter, resolveDeadLetter } from "./notificationDeadLetterService.js";
import { computeWebhookRoutePlan } from "./notificationRoutingService.js";
import { buildWebhookPayload, buildLegacyPayload } from "./notificationWebhookPayloadTemplateService.js";
import { getAppVersionInfo } from "@uaiw/shared/version.js";

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
  destinationId?: string;
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

const WEBHOOK_USER_AGENT = `UnifiedAIWorkspace/${getAppVersionInfo().version}`;

const WEBHOOK_PROVIDER: NotificationChannelProvider = {
  channel: "webhook",
  async deliver(input, pref) {
    let destId = input.destinationId;
    let config: any = null;

    if (destId) {
      const dest = await prisma.notificationWebhookDestination.findUnique({
        where: { id: destId }
      });
      if (dest && dest.enabled) {
        config = {
          url: dest.encryptedUrl ? decryptSecretString(dest.encryptedUrl) : null,
          secret: dest.encryptedSigningSecret ? decryptSecretString(dest.encryptedSigningSecret) : null,
          timeoutMs: dest.timeoutMs || env.NOTIFICATION_WEBHOOK_TIMEOUT_MS,
          dest, // keep full record for payload builder
        };
      }
    } else {
      // First delivery attempt, fallback to legacy if no destinations exist? Or just routing plan.
      // Wait, routing is done before calling `deliver`.
      // The `deliverNotificationEvent` calls this. If no `destinationId` is provided, we should run routing.
      const routePlan = await computeWebhookRoutePlan(input.userId, { id: input.eventId, kind: input.kind, severity: input.severity } as any);
      if (routePlan.destinations.length > 0) {
        const dest = await prisma.notificationWebhookDestination.findUnique({
          where: { id: routePlan.destinations[0].destinationId }
        });
        if (dest && dest.enabled) {
          config = {
            url: dest.encryptedUrl ? decryptSecretString(dest.encryptedUrl) : null,
            secret: dest.encryptedSigningSecret ? decryptSecretString(dest.encryptedSigningSecret) : null,
            timeoutMs: dest.timeoutMs || env.NOTIFICATION_WEBHOOK_TIMEOUT_MS,
            dest, // keep full record for payload builder
          };
          input.destinationId = dest.id;
        }
      } else {
        // Fallback to legacy config if present
        const record = await prisma.notificationDeliveryPreference.findUnique({
          where: { userId_channel: { userId: input.userId, channel: "webhook" } }
        });
        if (record?.configJson) {
          const parsed = JSON.parse(record.configJson);
          if (parsed.url && parsed.encryptedSigningSecret) {
            config = {
              url: parsed.url,
              secret: decryptSecretString(parsed.encryptedSigningSecret),
              timeoutMs: env.NOTIFICATION_WEBHOOK_TIMEOUT_MS
            };
            input.destinationId = "legacy";
          }
        }
      }
    }

    if (!config || !config.url || !config.secret) {
      return { status: "skipped_not_configured" };
    }

    // Build payload using template service
    let rawBody: string;
    let payloadMeta: { format: string; schema: string; sizeBytes: number } | undefined;

    if (config.dest) {
      // Destination-based payload building
      const result = buildWebhookPayload({
        event: {
          id: input.eventId,
          kind: input.kind,
          title: input.title,
          message: input.message,
          severity: input.severity,
          createdAt: new Date().toISOString(),
          actionHref: input.actionHref,
        },
        destination: {
          id: config.dest.id,
          name: config.dest.name,
          payloadFormat: config.dest.payloadFormat,
          payloadFields: config.dest.payloadFields,
          includeActionHref: config.dest.includeActionHref,
          includeDeliveryMetadata: config.dest.includeDeliveryMetadata,
          includeRoutingMetadata: config.dest.includeRoutingMetadata,
        },
      });
      rawBody = result.rawBody;
      payloadMeta = { format: result.format, schema: result.schema, sizeBytes: result.sizeBytes };
    } else {
      // Legacy payload building
      const result = buildLegacyPayload({
        eventId: input.eventId,
        kind: input.kind,
        severity: input.severity,
        title: input.title,
        message: input.message,
        provider: input.provider,
        modelId: input.modelId,
        actionHref: input.actionHref,
      });
      rawBody = result.rawBody;
      payloadMeta = { format: "uaiw_legacy", schema: "uaiw.notification.v1", sizeBytes: result.sizeBytes };
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", config.secret).update(`${timestamp}.${rawBody}`).digest("hex");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UAIW-Event-Id": input.eventId,
          "X-UAIW-Timestamp": timestamp,
          "X-UAIW-Signature": `sha256=${signature}`,
          "User-Agent": WEBHOOK_USER_AGENT
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
          metadata: { statusCode: response.status, ...payloadMeta }
        };
      }

      return { status: "delivered", metadata: { statusCode: response.status, ...payloadMeta } };
    } catch (err: any) {
      clearTimeout(timeoutId);
      return {
        status: "failed",
        errorCode: err.name === "AbortError" ? "timeout" : "network_error",
        metadata: { error: err.message, ...payloadMeta }
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
        const dest = deliveryInput.destinationId && deliveryInput.destinationId !== "legacy" 
          ? await prisma.notificationWebhookDestination.findUnique({ where: { id: deliveryInput.destinationId } }) 
          : null;
        
        const maxAttempts = dest?.maxAttempts || env.NOTIFICATION_WEBHOOK_RETRY_MAX_ATTEMPTS;
        
        const delayMs = computeNextRetryDelayMs(1);
        if (delayMs !== null && 1 < maxAttempts) {
          retryable = true;
          nextRetryAt = new Date(Date.now() + delayMs);
          const retryEnqueued = await enqueueWebhookDeliveryRetry({
            userId,
            notificationEventId: event.id,
            delayMs,
            attemptNumber: 2,
            reason: result.errorCode,
            destinationId: deliveryInput.destinationId,
            routeAttemptIndex: 0
          });
          jobId = retryEnqueued.jobId;
        }
      }

      const meta: any = result.metadata || {};
      if (deliveryInput.destinationId) {
        meta.destinationId = deliveryInput.destinationId;
        meta.routeAttemptIndex = 0;
      }

      const record = await prisma.notificationDeliveryAttempt.create({
        data: {
          userId,
          notificationEventId: event.id,
          channel: provider.channel,
          status: result.status,
          errorCode: result.errorCode,
          metadataJson: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
          attemptNumber: 1,
          retryable,
          nextRetryAt,
          jobId
        }
      });

      if (result.status === "failed" && !nextRetryAt && provider.channel === "webhook") {
        // Fallback failover logic handled by the initial attempt if no retry is allowed
        // Actually, failover logic is mostly for the retry processor, but if we fail immediately (e.g. non-retryable),
        // we might failover right away. But to keep it simple and decouple it, we can enqueue a failover job.
        // For now, enqueue a retry job with attemptNumber=maxAttempts so the processor can handle failover
        if (deliveryInput.destinationId && deliveryInput.destinationId !== "legacy") {
          const retryEnqueued = await enqueueWebhookDeliveryRetry({
            userId,
            notificationEventId: event.id,
            delayMs: 1000,
            attemptNumber: 999, // trigger exhaustion/failover immediately in worker
            reason: result.errorCode,
            destinationId: deliveryInput.destinationId,
            routeAttemptIndex: 0
          });
          
          await prisma.notificationDeliveryAttempt.update({
             where: { id: record.id },
             data: { jobId: retryEnqueued.jobId, nextRetryAt: new Date(Date.now() + 1000) }
          });
        } else {
          await createOrUpdateDeadLetter({
            userId,
            notificationEventId: event.id,
            deliveryAttemptId: record.id,
            channel: provider.channel,
            reason: result.errorCode || "delivery_failed",
            failureCode: result.errorCode,
            retryable: false
          }).catch(err => console.error("Failed to create dead letter", err));
        }
      } else if (result.status === "failed" && !nextRetryAt) {
        await createOrUpdateDeadLetter({
          userId,
          notificationEventId: event.id,
          deliveryAttemptId: record.id,
          channel: provider.channel,
          reason: result.errorCode || "delivery_failed",
          failureCode: result.errorCode,
          retryable
        }).catch(err => console.error("Failed to create dead letter", err));
      }

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
        await createOrUpdateDeadLetter({
          userId,
          notificationEventId: event.id,
          deliveryAttemptId: record.id,
          channel: provider.channel,
          reason: "delivery_provider_error",
          failureCode: "delivery_provider_error",
          retryable: false
        }).catch(err => console.error("Failed to create dead letter", err));
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
  destinationId?: string;
  routeAttemptIndex?: number;
}): Promise<void> {
  const event = await prisma.notificationEvent.findUnique({
    where: { id: input.notificationEventId }
  });

  if (!event || event.userId !== input.userId) {
    return;
  }

  let routeAttemptIndex = input.routeAttemptIndex || 0;
  
  const payload: SafeNotificationDeliveryPayload = {
    eventId: event.id,
    kind: event.kind,
    severity: event.severity,
    title: event.title,
    message: event.message,
    provider: event.provider,
    modelId: event.modelId,
    actionHref: event.actionHref,
    userId: input.userId,
    destinationId: input.destinationId
  };

  const result = await WEBHOOK_PROVIDER.deliver(payload, { config: {} });

  // Update last success/failure on destination
  if (input.destinationId && input.destinationId !== "legacy") {
    await prisma.notificationWebhookDestination.updateMany({
      where: { id: input.destinationId },
      data: result.status === "delivered" 
        ? { lastSuccessAt: new Date() }
        : { lastFailureAt: new Date() }
    });
  }

  let retryable = false;
  let nextRetryAt: Date | null = null;
  let jobId: string | null = null;

  const dest = input.destinationId && input.destinationId !== "legacy" 
          ? await prisma.notificationWebhookDestination.findUnique({ where: { id: input.destinationId } }) 
          : null;
        
  const maxAttempts = dest?.maxAttempts || env.NOTIFICATION_WEBHOOK_RETRY_MAX_ATTEMPTS;

  if (result.status === "failed" && isRetryableError(result.errorCode)) {
    const delayMs = computeNextRetryDelayMs(input.attemptNumber);
    if (delayMs !== null && input.attemptNumber < maxAttempts) {
      retryable = true;
      nextRetryAt = new Date(Date.now() + delayMs);
      const retryEnqueued = await enqueueWebhookDeliveryRetry({
        userId: input.userId,
        notificationEventId: event.id,
        delayMs,
        attemptNumber: input.attemptNumber + 1,
        reason: result.errorCode,
        destinationId: input.destinationId,
        routeAttemptIndex
      });
      jobId = retryEnqueued.jobId;
    }
  }

  const meta: any = result.metadata || {};
  if (input.destinationId) {
    meta.destinationId = input.destinationId;
    meta.routeAttemptIndex = routeAttemptIndex;
  }

  const record = await prisma.notificationDeliveryAttempt.create({
    data: {
      userId: input.userId,
      notificationEventId: event.id,
      channel: "webhook",
      status: result.status,
      errorCode: result.errorCode,
      metadataJson: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
      attemptNumber: input.attemptNumber,
      retryable,
      nextRetryAt,
      jobId
    }
  });

  if (result.status === "failed" && !nextRetryAt) {
    let failoverTriggered = false;

    if (dest?.failoverEnabled) {
      const routePlan = await computeWebhookRoutePlan(input.userId, { id: event.id, kind: event.kind, severity: event.severity } as any);
      if (routePlan.destinations.length > routeAttemptIndex + 1) {
        // Enqueue failover to next destination
        const nextDest = routePlan.destinations[routeAttemptIndex + 1];
        failoverTriggered = true;
        await enqueueWebhookDeliveryRetry({
          userId: input.userId,
          notificationEventId: event.id,
          delayMs: 1000,
          attemptNumber: 1, // Reset attempt number for the new destination
          reason: "failover_from_" + input.destinationId,
          destinationId: nextDest.destinationId,
          routeAttemptIndex: routeAttemptIndex + 1
        });
      }
    }

    if (!failoverTriggered) {
      await createOrUpdateDeadLetter({
        userId: input.userId,
        notificationEventId: event.id,
        deliveryAttemptId: record.id,
        channel: "webhook",
        reason: result.errorCode || "delivery_failed_no_failover",
        failureCode: result.errorCode,
        retryable: false // Exhausted all failovers or no failover enabled
      }).catch(err => console.error("Failed to create dead letter", err));
    }
  } else if (result.status === "delivered") {
    const existingDlq = await prisma.notificationDeadLetter.findFirst({
      where: {
        userId: input.userId,
        notificationEventId: event.id,
        channel: "webhook"
      }
    });
    if (existingDlq) {
      await resolveDeadLetter(existingDlq.id, input.userId, "retry_succeeded").catch(() => {});
    }
  }
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
