import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth/requirePermission.js";
import { attachLocalUser } from "../middleware/auth.js";
import { PROVIDERS, type ProviderId } from "@uaiw/shared/types/provider.js";
import {
  getProviderHealth,
  refreshProviderHealth,
  refreshAllProviderHealth
} from "../services/providerHealthService.js";

const providerParams = z.object({
  provider: z.enum(PROVIDERS)
});

export async function providerHealthRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/provider-health", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.read"))) return;
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const healths = await getProviderHealth(request.user.id);
    return reply.send({ data: healths });
  });

  app.post("/settings/provider-health/:provider/refresh", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.action"))) return;
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = providerParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid provider" });
    }

    const result = await refreshProviderHealth(request.user.id, parsed.data.provider);
    return reply.send(result);
  });

  app.post("/settings/provider-health/refresh-all", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.action"))) return;
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const results = await refreshAllProviderHealth(request.user.id);
    return reply.send({ data: results });
  });
}
