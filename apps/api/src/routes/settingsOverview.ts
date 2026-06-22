import type { FastifyInstance } from "fastify";
import { requirePermission } from "../auth/requirePermission.js";
import { attachLocalUser } from "../middleware/auth.js";
import { getSettingsOverview } from "../services/settingsOverviewService.js";

export async function settingsOverviewRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/overview", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;
    const overview = await getSettingsOverview(request.user.id, request.user, request.workspaceContext);
    return reply.send(overview);
  });
}
