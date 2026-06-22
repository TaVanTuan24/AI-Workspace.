import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { attachLocalUser } from "../middleware/auth.js";
import { getProviderLimitAnalytics, getUsageSummary, listUsageLogs } from "../services/apiUsageService.js";

const summaryQuerySchema = z.object({
  from: z.string().optional().transform(v => v ? new Date(v) : undefined),
  to: z.string().optional().transform(v => v ? new Date(v) : undefined),
  apiKeyId: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
});

const logsQuerySchema = summaryQuerySchema.extend({
  page: z.coerce.number().default(1),
  pageSize: z.coerce.number().default(50),
  status: z.string().optional(),
});

const providerLimitsQuerySchema = z.object({
  range: z.enum(["24h", "7d"]).default("24h")
});

export async function apiUsageRoutes(app: FastifyInstance) {
  // Use standard app auth, not API key auth.
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/api-usage/summary", async (request, reply) => {
    // Make sure user is fully authenticated
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = summaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query parameters" });
    }

    const summary = await getUsageSummary(request.user.id, parsed.data);
    return reply.send(summary);
  });

  app.get("/settings/api-usage/logs", async (request, reply) => {
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = logsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query parameters" });
    }

    const logs = await listUsageLogs(request.user.id, parsed.data);
    return reply.send(logs);
  });

  app.get("/settings/api-usage/provider-limits", async (request, reply) => {
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = providerLimitsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid range. Use 24h or 7d." });
    }

    const summary = await getProviderLimitAnalytics(request.user.id, { range: parsed.data.range });
    return reply.send({ summary });
  });
}
