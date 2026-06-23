import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth/requirePermission.js";
import { attachLocalUser } from "../middleware/auth.js";
import {
  getNotificationPreferences,
  updateNotificationPreferences
} from "../services/notificationPreferenceService.js";

const updateBody = z.object({
  notifyProviderSessionIssues: z.boolean().optional(),
  notifyNoUsableModels: z.boolean().optional(),
  notifyProviderLimitSpikes: z.boolean().optional(),
  providerLimitSpikeThreshold24h: z.number().int().min(1).max(10_000).optional(),
  notifyWorkspaceQuotaWarnings: z.boolean().optional(),
  notifyWorkspaceQuotaExceeded: z.boolean().optional(),
  workspaceQuotaWarningThresholdPercent: z.number().int().min(50).max(99).optional()
});

export async function notificationPreferenceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/notification-preferences", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.read"))) return;
    const preferences = await getNotificationPreferences(request.user.id);
    return reply.send({ preferences });
  });

  app.patch("/settings/notification-preferences", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.write"))) return;
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        errorCode: "INVALID_NOTIFICATION_PREFERENCES",
        message: "Invalid notification preferences."
      });
    }

    try {
      const preferences = await updateNotificationPreferences(request.user.id, parsed.data);
      return reply.send({ preferences });
    } catch (error: any) {
      return reply.code(400).send({
        errorCode: "INVALID_NOTIFICATION_PREFERENCES",
        message: error.message ?? "Invalid notification preferences."
      });
    }
  });
}
