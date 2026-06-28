import type { FastifyInstance } from "fastify";
import { requirePermission } from "../auth/requirePermission.js";
import { attachLocalUser } from "../middleware/auth.js";
import { getStorageStats } from "../services/storageStatsService.js";

export async function storageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/storage", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;
    const stats = await getStorageStats();
    return reply.send(stats);
  });
}
