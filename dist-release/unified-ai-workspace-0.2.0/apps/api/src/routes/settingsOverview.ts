import type { FastifyInstance } from "fastify";
import { attachLocalUser } from "../middleware/auth.js";
import { getSettingsOverview } from "../services/settingsOverviewService.js";

export async function settingsOverviewRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/overview", async (request, reply) => {
    const overview = await getSettingsOverview(request.user.id);
    return reply.send(overview);
  });
}
