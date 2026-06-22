import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth/requirePermission.js";
import { attachLocalUser } from "../middleware/auth.js";
import { getModelPreferences, updateModelPreferences } from "../services/modelPreferenceService.js";

const updatePreferencesSchema = z.object({
  autoSelectFirstUsable: z.boolean(),
  models: z.array(z.object({
    modelId: z.string(),
    enabled: z.boolean(),
    isDefault: z.boolean(),
    priority: z.number(),
    selectedSubModelId: z.string().optional()
  }))
});

export async function modelPreferenceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/models", async (request, reply) => {
    if (!(await requirePermission(request, reply, "models.read"))) return;
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const preferences = await getModelPreferences(request.user.id);
    return reply.send(preferences);
  });

  app.put("/settings/models", async (request, reply) => {
    if (!(await requirePermission(request, reply, "models.write"))) return;
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = updatePreferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body" });
    }

    const updated = await updateModelPreferences(request.user.id, request.user.workspaceId!, parsed.data);
    return reply.send(updated);
  });
}
