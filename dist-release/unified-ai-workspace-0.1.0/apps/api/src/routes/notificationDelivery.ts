import type { FastifyInstance } from "fastify";
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
import type { NotificationDeliveryChannel } from "@uaiw/shared/types/provider.js";

export async function notificationDeliveryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/notification-delivery/preferences", async (request, reply) => {
    const preferences = await getNotificationDeliveryPreferences(request.user.id);
    return reply.send({ preferences });
  });

  app.patch("/settings/notification-delivery/preferences/:channel", async (request, reply) => {
    const { channel } = request.params as { channel: NotificationDeliveryChannel };
    const { enabled } = request.body as { enabled: boolean };

    try {
      const pref = await updateNotificationDeliveryPreference(request.user.id, channel, { enabled });
      return reply.send(pref);
    } catch (err) {
      if (err instanceof Error && err.message === "Invalid channel") {
        return reply.status(400).send({ error: "Invalid channel" });
      }
      throw err;
    }
  });

  app.get("/settings/notification-delivery/attempts", async (request, reply) => {
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
    const preferences = await getNotificationDeliveryPreferences(request.user.id);
    const webhookPref = preferences.find(p => p.channel === "webhook");
    if (!webhookPref) {
      return reply.status(404).send({ error: "Webhook configuration not found" });
    }
    return reply.send(webhookPref);
  });

  app.put("/settings/notification-delivery/webhook", async (request, reply) => {
    const { enabled, url } = request.body as { enabled: boolean; url: string };
    try {
      const result = await updateWebhookConfig(request.user.id, { enabled, url });
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post("/settings/notification-delivery/webhook/rotate-secret", async (request, reply) => {
    try {
      const result = await rotateWebhookSigningSecret(request.user.id);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post("/settings/notification-delivery/webhook/test", async (request, reply) => {
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

  app.post("/settings/notification-delivery/attempts/:id/retry", async (request, reply) => {
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
}
