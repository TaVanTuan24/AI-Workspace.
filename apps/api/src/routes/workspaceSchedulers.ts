import type { FastifyInstance } from "fastify";
import { requirePermission } from "../auth/requirePermission.js";
import { getWorkspaceContextForRequest } from "../auth/workspaceContext.js";
import { getSchedulerFleetStatus } from "../services/schedulerFleetStatusService.js";

import { attachLocalUser } from "../middleware/auth.js";

export async function workspaceSchedulerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);
  app.get("/settings/workspace/schedulers", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const status = await getSchedulerFleetStatus();
    return reply.send(status);
  });
}
