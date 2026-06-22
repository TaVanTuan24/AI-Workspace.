import type { FastifyInstance } from "fastify";
import { requirePermission } from "../auth/requirePermission.js";
import { attachLocalUser } from "../middleware/auth.js";
import {
  getNotificationDeliveryPreferences,
  updateNotificationDeliveryPreference,
  updateWebhookConfig,
  rotateWebhookSigningSecret
} from "../services/notificationDeliveryPreferenceService.js";
import { deliverNotificationEvent, listNotificationDeliveryAttempts } from "../services/notificationDeliveryService.js";
import { enqueueWebhookDeliveryRetry } from "../services/notificationWebhookRetryQueue.js";
import { prisma } from "../services/prisma.js";
import { listDeadLetters, getDeadLetterDetails, retryDeadLetter, resolveDeadLetter, reconcileDeadLetters } from "../services/notificationDeadLetterService.js";
import { 
  listWebhookDestinations, 
  createWebhookDestination, 
  updateWebhookDestination, 
  rotateDestinationSecret, 
  deleteWebhookDestination 
} from "../services/notificationWebhookDestinationService.js";
import { computeWebhookRoutePlan } from "../services/notificationRoutingService.js";
import { buildWebhookPayload } from "../services/notificationWebhookPayloadTemplateService.js";
import type { NotificationDeliveryChannel } from "@uaiw/shared/types/provider.js";

export async function notificationDeliveryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/notification-delivery/preferences", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.read"))) return;
    const preferences = await getNotificationDeliveryPreferences(request.user.id);
    return reply.send({ preferences });
  });

  app.patch("/settings/notification-delivery/preferences/:channel", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.write"))) return;
    const { channel } = request.params as { channel: NotificationDeliveryChannel };
    const { enabled } = request.body as { enabled: boolean };

    try {
      const pref = await updateNotificationDeliveryPreference(request.user.id, request.user.workspaceId!, channel, { enabled });
      return reply.send(pref);
    } catch (err) {
      if (err instanceof Error && err.message === "Invalid channel") {
        return reply.status(400).send({ error: "Invalid channel" });
      }
      throw err;
    }
  });

  app.get("/settings/notification-delivery/attempts", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.read"))) return;
    const query = request.query as { limit?: string; notificationEventId?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    
    const attempts = await listNotificationDeliveryAttempts({
      userId: request.user.id,
      notificationEventId: query.notificationEventId,
      limit
    });
    
    return reply.send({ attempts });
  });

  app.get("/settings/notification-delivery/webhook", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.read"))) return;
    const preferences = await getNotificationDeliveryPreferences(request.user.id);
    const webhookPref = preferences.find(p => p.channel === "webhook");
    if (!webhookPref) {
      return reply.status(404).send({ error: "Webhook configuration not found" });
    }
    return reply.send(webhookPref);
  });

  app.put("/settings/notification-delivery/webhook", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.write"))) return;
    const { enabled, url } = request.body as { enabled: boolean; url: string };
    try {
      const result = await updateWebhookConfig(request.user.id, request.user.workspaceId!, { enabled, url });
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post("/settings/notification-delivery/webhook/rotate-secret", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.write"))) return;
    try {
      const result = await rotateWebhookSigningSecret(request.user.id, request.user.workspaceId!);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post("/settings/notification-delivery/webhook/test", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.write"))) return;
    try {
      const attempts = await deliverNotificationEvent(request.user.id, {
        id: `test_${Date.now()}`,
        kind: "test_webhook",
        severity: "info",
        title: "Test Webhook Delivery",
        message: "This is a test notification payload.",
        createdAt: new Date().toISOString(),
        fingerprint: `test:webhook:${Date.now()}`
      });
      return reply.send({ attempts });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  app.get("/settings/notification-delivery/webhook-destinations", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.read"))) return;
    const destinations = await listWebhookDestinations(request.user.id);
    return reply.send({ destinations });
  });

  app.post("/settings/notification-delivery/webhook-destinations", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.write"))) return;
    try {
      const result = await createWebhookDestination(request.user.id, request.user.workspaceId!, request.body);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.patch("/settings/notification-delivery/webhook-destinations/:id", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.write"))) return;
    const { id } = request.params as { id: string };
    try {
      const result = await updateWebhookDestination(request.user.id, id, request.body);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post("/settings/notification-delivery/webhook-destinations/:id/rotate-secret", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.write"))) return;
    const { id } = request.params as { id: string };
    try {
      const result = await rotateDestinationSecret(request.user.id, id);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post("/settings/notification-delivery/webhook-destinations/:id/test", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.write"))) return;
    const { id } = request.params as { id: string };
    try {
      // Create a test event and deliver only to this destination by injecting it into a modified deliverNotificationEvent call?
      // Wait, deliverNotificationEvent iterates preferences. Better to directly invoke WEBHOOK_PROVIDER.deliver or 
      // just set `destinationId` in the queue/event. Since deliverNotificationEvent doesn't accept destinationId directly,
      // let's create a specialized test function or just a temporary queue job.
      // But we can also just use enqueueWebhookDeliveryRetry directly? No, we need an event.
      // Easiest is to let deliverNotificationEvent handle it and somehow force destination.
      // Actually, WEBHOOK_PROVIDER doesn't export. We should just let the user test via a generic event, 
      // but if we want to test a SPECIFIC destination, we can't easily without exposing it.
      // The prompt says "Send safe test event to a single destination."
      // I'll add an internal method or just do it in the route.
      // Actually, since I modified deliverNotificationEvent's internal `WEBHOOK_PROVIDER.deliver` to take `destinationId` inside `SafeNotificationDeliveryPayload`, it's not exported.
      // To test a single destination, we can just enqueue a fake retry for it!
      // But we need a real `NotificationEvent` in DB first for retry queue.
      const event = await prisma.notificationEvent.create({
        data: {
          userId: request.user.id,
          kind: "test_webhook",
          severity: "info",
          title: "Test Webhook Destination",
          message: "This is a targeted test for a specific webhook destination.",
          fingerprint: `test:webhook:target:${id}:${Date.now()}`
        }
      });
      const { jobId } = await enqueueWebhookDeliveryRetry({
        userId: request.user.id,
        notificationEventId: event.id,
        delayMs: 0,
        attemptNumber: 1,
        reason: "manual_test",
        destinationId: id,
        routeAttemptIndex: 0
      });
      return reply.send({ queued: true, jobId });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  app.delete("/settings/notification-delivery/webhook-destinations/:id", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.write"))) return;
    const { id } = request.params as { id: string };
    try {
      const result = await deleteWebhookDestination(request.user.id, id);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post("/settings/notification-delivery/webhook-destinations/:id/payload-preview", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.write"))) return;
    const { id } = request.params as { id: string };
    const { kind, severity, priority, title, message } = (request.body || {}) as any;
    try {
      const dest = await prisma.notificationWebhookDestination.findUnique({ where: { id } });
      if (!dest || dest.userId !== request.user.id) {
        return reply.status(404).send({ error: "Destination not found" });
      }

      const sampleEvent = {
        id: "preview_" + Date.now(),
        kind: (kind || "test_webhook").substring(0, 100),
        severity: (severity || "info").substring(0, 50),
        title: (title || "Sample notification title").substring(0, 200),
        message: (message || "This is a sample notification message for payload preview.").substring(0, 1000),
        createdAt: new Date().toISOString(),
        actionHref: "/settings/notifications",
      };

      const result = buildWebhookPayload({
        event: sampleEvent,
        destination: {
          id: dest.id,
          name: dest.name,
          payloadFormat: dest.payloadFormat,
          payloadFields: dest.payloadFields,
          includeActionHref: dest.includeActionHref,
          includeDeliveryMetadata: dest.includeDeliveryMetadata,
          includeRoutingMetadata: dest.includeRoutingMetadata,
        },
        deliveryAttemptId: "preview_attempt",
        routing: { reason: "preview", failoverIndex: 0 },
      });

      return reply.send({
        payload: result.payload,
        sizeBytes: result.sizeBytes,
        schema: result.schema,
        format: result.format,
        includedFields: result.includedFields,
        warnings: result.warnings,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  app.post("/settings/notification-delivery/routes/preview", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.write"))) return;
    const { kind, severity, priority } = request.body as any;
    try {
      const plan = await computeWebhookRoutePlan(request.user.id, {
        id: "preview_event",
        kind: kind || "test_webhook",
        severity: severity || "info",
        title: "Preview",
        message: "Preview",
        createdAt: new Date().toISOString(),
        fingerprint: "preview"
      });
      return reply.send({ plan });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  app.post("/settings/notification-delivery/attempts/:id/retry", async (request, reply) => {
    if (!(await requirePermission(request, reply, "webhooks.write"))) return;
    const { id } = request.params as { id: string };
    
    const attempt = await prisma.notificationDeliveryAttempt.findUnique({
      where: { id }
    });

    if (!attempt || attempt.userId !== request.user.id) {
      return reply.status(404).send({ error: "Attempt not found" });
    }

    if (attempt.channel !== "webhook") {
      return reply.status(400).send({ error: "Only webhook attempts can be retried" });
    }

    if (attempt.status !== "failed") {
      return reply.status(400).send({ error: "Only failed attempts can be retried" });
    }

    const { jobId } = await enqueueWebhookDeliveryRetry({
      userId: request.user.id,
      notificationEventId: attempt.notificationEventId,
      delayMs: 0,
      attemptNumber: attempt.attemptNumber + 1,
      reason: "manual_retry"
    });

    // Update the attempt to show it's queued for retry
    await prisma.notificationDeliveryAttempt.update({
      where: { id },
      data: {
        jobId,
        nextRetryAt: new Date()
      }
    });

    return reply.send({ queued: true, jobId, notificationEventId: attempt.notificationEventId });
  });

  app.get("/settings/notification-delivery/dead-letters", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.read"))) return;
    const query = request.query as { status?: string; limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 50;

    const deadLetters = await listDeadLetters(request.user.id, {
      status: query.status,
      limit
    });

    return reply.send({ deadLetters });
  });

  app.get("/settings/notification-delivery/dead-letters/:id", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.read"))) return;
    const { id } = request.params as { id: string };
    
    const deadLetter = await getDeadLetterDetails(id, request.user.id);
    if (!deadLetter) {
      return reply.status(404).send({ error: "Dead letter not found" });
    }

    return reply.send(deadLetter);
  });

  app.post("/settings/notification-delivery/dead-letters/:id/retry", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.write"))) return;
    const { id } = request.params as { id: string };
    
    try {
      const result = await retryDeadLetter(id, request.user.id);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post("/settings/notification-delivery/dead-letters/:id/resolve", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.write"))) return;
    const { id } = request.params as { id: string };
    const { resolution, note } = request.body as { resolution: string; note?: string };
    
    if (!["ignored", "fixed_externally", "no_longer_needed"].includes(resolution)) {
      return reply.status(400).send({ error: "Invalid resolution status" });
    }

    try {
      const safeNote = note ? note.substring(0, 500) : undefined;
      const result = await resolveDeadLetter(id, request.user.id, resolution + (safeNote ? `: ${safeNote}` : ""));
      return reply.send({ id: result.id, status: result.status });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post("/settings/notification-delivery/dead-letters/reconcile", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.write"))) return;
    try {
      const result = await reconcileDeadLetters(request.user.id);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
