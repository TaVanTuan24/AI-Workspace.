import type { FastifyInstance } from "fastify";
import { requirePermission } from "../auth/requirePermission.js";
import { getWorkspaceContextForRequest } from "../auth/workspaceContext.js";
import {
  getWorkspaceActivityTimeline,
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
  type ActivityRange,
} from "../services/workspaceActivityService.js";

const VALID_RANGES = ["24h", "7d", "30d", "90d"] as const;

export async function workspaceActivityRoutes(app: FastifyInstance) {
  app.get("/settings/workspace/activity", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const query = request.query as Record<string, string | undefined>;
    const range = (query.range ?? "7d") as ActivityRange;
    if (!VALID_RANGES.includes(range as any)) {
      return reply.code(400).send({ error: "invalid_range" });
    }

    const categoryParam = query.category;
    let categories: ActivityCategory[] | undefined;
    if (categoryParam) {
      const requested = categoryParam.split(",").map((c) => c.trim()) as ActivityCategory[];
      const invalid = requested.filter((c) => !ACTIVITY_CATEGORIES.includes(c));
      if (invalid.length > 0) {
        return reply.code(400).send({ error: "invalid_category", invalid });
      }
      categories = requested;
    }

    const limit = Math.min(Math.max(parseInt(query.limit ?? "50", 10) || 50, 1), 200);
    const cursor = query.cursor;

    const userId = request.headers["x-local-user-id"] as string;

    const result = await getWorkspaceActivityTimeline({
      actorUserId: userId,
      workspaceId: ctx.workspaceId,
      range,
      cursor,
      limit,
      filters: categories ? { categories } : undefined,
    });

    return reply.send(result);
  });
}
