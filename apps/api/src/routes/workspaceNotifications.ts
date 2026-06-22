import type { FastifyInstance } from "fastify";
import { requirePermission } from "../auth/requirePermission.js";
import { attachLocalUser } from "../middleware/auth.js";
import { getWorkspaceNotifications } from "../services/workspaceNotificationService.js";
import { listNotificationEvents } from "../services/notificationEventService.js";

export async function workspaceNotificationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/notifications", async (request, reply) => {
    if (!(await requirePermission(request, reply, "notifications.read"))) return;
    const notifications = await getWorkspaceNotifications(request.user.id, {
      materializeEvents: true
    });
    
    // We also return the total unreadCount from history for global badge
    const { unreadCount } = await listNotificationEvents({
      userId: request.user.id,
      limit: 1 // We only need the count
    });
    
    return reply.send({ notifications, unreadCount });
  });
}
