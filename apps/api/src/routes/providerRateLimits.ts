import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isProviderId } from "@uaiw/shared/types/provider.js";
import { requirePermission } from "../auth/requirePermission.js";
import { attachLocalUser } from "../middleware/auth.js";
import {
  listProviderRateLimitSettings,
  updateProviderRateLimitSetting
} from "../services/providerRateLimitService.js";

const updateBody = z.object({
  requestsPerMinute: z.number().int().positive().nullable()
});

export async function providerRateLimitRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/provider-rate-limits", async (request, reply) => {
    if (!(await requirePermission(request, reply, "models.read"))) return;
    return reply.send(await listProviderRateLimitSettings(request.user.id));
  });

  app.patch("/settings/provider-rate-limits/:provider", async (request, reply) => {
    if (!(await requirePermission(request, reply, "models.write"))) return;
    const { provider } = z.object({ provider: z.string() }).parse(request.params);
    if (!isProviderId(provider)) {
      return reply.code(400).send({
        errorCode: "INVALID_PROVIDER",
        message: "Unknown provider."
      });
    }

    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        errorCode: "INVALID_RATE_LIMIT",
        message: "requestsPerMinute must be a positive integer or null."
      });
    }

    try {
      const limit = await updateProviderRateLimitSetting(
        request.user.id,
        provider,
        parsed.data.requestsPerMinute
      );
      return reply.send({ limit });
    } catch (error: any) {
      return reply.code(400).send({
        errorCode: "INVALID_RATE_LIMIT",
        message: error.message ?? "Invalid provider rate limit setting."
      });
    }
  });
}
