import type { FastifyInstance } from "fastify";
import { requirePermission } from "../auth/requirePermission.js";
import { getWorkspaceContextForRequest } from "../auth/workspaceContext.js";
import { getWorkspaceAdminExport } from "../services/workspaceAdminExportService.js";
import type { ActivityRange } from "../services/workspaceActivityService.js";

const VALID_RANGES = ["24h", "7d", "30d", "90d"] as const;

import { attachLocalUser } from "../middleware/auth.js";

export async function workspaceAdminExportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);
  app.get("/settings/workspace/admin-export", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const query = request.query as Record<string, string | undefined>;
    const range = (query.range ?? "30d") as ActivityRange;
    if (!VALID_RANGES.includes(range as any)) {
      return reply.code(400).send({ error: "invalid_range" });
    }

    const userId = request.headers["x-local-user-id"] as string;

    const exportData = await getWorkspaceAdminExport({
      actorUserId: userId,
      workspaceId: ctx.workspaceId,
      range,
    });

    return reply.send(exportData);
  });

  app.get("/settings/workspace/admin-export/download", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const query = request.query as Record<string, string | undefined>;
    const range = (query.range ?? "30d") as ActivityRange;
    if (!VALID_RANGES.includes(range as any)) {
      return reply.code(400).send({ error: "invalid_range" });
    }

    const userId = request.headers["x-local-user-id"] as string;

    const exportData = await getWorkspaceAdminExport({
      actorUserId: userId,
      workspaceId: ctx.workspaceId,
      range,
    });

    const slug = exportData.workspace.slug || exportData.workspace.id;
    const filename = `workspace-admin-export-${slug}-${range}.json`;

    return reply
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .type("application/json")
      .send(exportData);
  });
}
