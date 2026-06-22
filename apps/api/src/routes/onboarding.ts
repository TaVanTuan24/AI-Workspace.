import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { attachLocalUser } from "../middleware/auth.js";
import { getOnboardingStatus, updateOnboardingStatus } from "../services/onboardingService.js";

const updateOnboardingSchema = z.object({
  lastStep: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  skipped: z.boolean().optional()
});

export async function onboardingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/onboarding", async (request, reply) => {
    const status = await getOnboardingStatus(request.user.id);
    return reply.send(status);
  });

  app.patch("/settings/onboarding", async (request, reply) => {
    const parsed = updateOnboardingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid onboarding update" });
    }

    const status = await updateOnboardingStatus(request.user.id, parsed.data);
    return reply.send(status);
  });
}
