import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { attachLocalUser } from "../middleware/auth.js";
import { PROVIDERS, type ProviderId } from "@uaiw/shared/types/provider.js";
import {
  getCachedLiveSubModels,
  refreshLiveSubModels
} from "../services/providerLiveSubModelService.js";

const providerParams = z.object({
  provider: z.enum(PROVIDERS)
});

export async function providerLiveSubModelsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/models/live-sub-models", async (request, reply) => {
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const caches = await getCachedLiveSubModels(request.user.id);
    return reply.send({ providers: caches });
  });

  app.post("/settings/models/live-sub-models/:provider/refresh", async (request, reply) => {
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = providerParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid provider" });
    }

    const result = await refreshLiveSubModels(request.user.id, parsed.data.provider);
    return reply.send(result);
  });
}
