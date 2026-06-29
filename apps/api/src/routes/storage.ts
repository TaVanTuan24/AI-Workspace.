import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth/requirePermission.js";
import { attachLocalUser } from "../middleware/auth.js";
import { getStorageStats } from "../services/storageStatsService.js";
import { runRetentionCleanup } from "../services/retentionCleanupService.js";
import { getSchedulerFleetStatus } from "../services/schedulerFleetStatusService.js";

const retentionRunBody = z.object({ dryRun: z.boolean().optional() });

export async function storageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/storage", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;
    const stats = await getStorageStats();
    return reply.send(stats);
  });

  // Background scheduler fleet status (provider health + retention cleanup):
  // enabled flag, last run status, run/failure/skip counts. Read-only.
  app.get("/settings/schedulers", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;
    const status = await getSchedulerFleetStatus();
    return reply.send(status);
  });

  // Run retention cleanup on demand (purges expired usage logs + notification
  // events). Pass { dryRun: true } to preview counts without deleting.
  app.post("/settings/storage/retention/run", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.write"))) return;
    const parsed = retentionRunBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body." });
    }
    const result = await runRetentionCleanup({ dryRun: parsed.data.dryRun ?? false });
    return reply.send(result);
  });
}
