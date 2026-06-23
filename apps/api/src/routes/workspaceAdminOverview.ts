import type { FastifyInstance } from "fastify";
import { requirePermission } from "../auth/requirePermission.js";
import { getWorkspaceContextForRequest } from "../auth/workspaceContext.js";
import { getWorkspaceAdminOverview } from "../services/workspaceAdminOverviewService.js";

export async function workspaceAdminOverviewRoutes(app: FastifyInstance) {
  app.get("/settings/workspace/admin-overview", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const overview = await getWorkspaceAdminOverview({ workspaceId: ctx.workspaceId });
    return reply.send(overview);
  });
}
