import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth/requirePermission.js";
import { attachLocalUser } from "../middleware/auth.js";
import {
  listNotificationEvents,
  markNotificationEventRead,
  markAllNotificationEventsRead
} from "../services/notificationEventService.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  unreadOnly: z.enum(["true", "false"]).optional(),
  kind: z.string().optional()
});

const eventIdParamsSchema = z.object({
  id: z.string()
});

export async function notificationEventsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/notification-events", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.read"))) return;
    const query = listQuerySchema.parse(request.query);
    const result = await listNotificationEvents({
      userId: request.user.id,
      limit: query.limit,
      unreadOnly: query.unreadOnly === "true",
      kind: query.kind
    });
    return reply.send(result);
  });

  app.patch("/settings/notification-events/:id/read", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.write"))) return;
    const { id } = eventIdParamsSchema.parse(request.params);
    try {
      const event = await markNotificationEventRead(request.user.id, id);
      return reply.send({ event });
    } catch (err: any) {
      if (err.message === "NOT_FOUND") {
        return reply.code(404).send({ error: "Notification event not found" });
      }
      throw err;
    }
  });

  app.patch("/settings/notification-events/read-all", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.write"))) return;
    const result = await markAllNotificationEventsRead(request.user.id);
    return reply.send({ updated: result.updated });
  });
}
