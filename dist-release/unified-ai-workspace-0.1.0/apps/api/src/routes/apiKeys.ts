import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { attachLocalUser } from "../middleware/auth.js";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  setApiKeyModelScopes,
  updateApiKeyRateLimit
} from "../services/apiKeyService.js";

const createApiKeyBody = z.object({
  name: z.string().min(1).max(100),
  allowedModelIds: z.array(z.string()).optional(),
  rateLimitPerMinute: z.number().nullable().optional()
});

const keyIdParam = z.object({
  id: z.string()
});

export async function apiKeyRoutes(app: FastifyInstance) {
  // Use standard app auth, not API key auth.
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/api-keys", async (request, reply) => {
    const keys = await listApiKeys(request.user.id);
    return reply.send({ keys });
  });

  app.post("/settings/api-keys", async (request, reply) => {
    const { name, allowedModelIds, rateLimitPerMinute } = createApiKeyBody.parse(request.body);
    const { rawKey, record } = await createApiKey({
      userId: request.user.id,
      name,
      allowedModelIds,
      rateLimitPerMinute
    });
    return reply.send({
      key: record,
      rawKey
    });
  });

  app.post("/settings/api-keys/:id/revoke", async (request, reply) => {
    const { id } = keyIdParam.parse(request.params);
    await revokeApiKey(request.user.id, id);
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string }, Body: { preserveScopes?: boolean } }>("/settings/api-keys/:id/rotate", async (request, reply) => {
    const { id } = keyIdParam.parse(request.params);
    try {
      const preserveScopes = request.body?.preserveScopes ?? true;
      const { rawKey, record } = await rotateApiKey(request.user.id, id, preserveScopes);
      return reply.send({
        key: record,
        rawKey
      });
    } catch (err: any) {
      return reply.code(404).send({ error: err.message || "Failed to rotate key" });
    }
  });

  const updateScopesSchema = z.object({
    allowedModelIds: z.array(z.string())
  });

  app.patch<{ Params: { id: string }, Body: { allowedModelIds: string[] } }>("/settings/api-keys/:id/scopes", async (request, reply) => {
    try {
      const parsed = updateScopesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }

      const key = await setApiKeyModelScopes(request.user.id, request.params.id, parsed.data.allowedModelIds);
      return reply.send({ key });
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  const updateRateLimitSchema = z.object({
    rateLimitPerMinute: z.number().int().positive().nullable()
  });

  app.patch<{ Params: { id: string }, Body: { rateLimitPerMinute: number | null } }>("/settings/api-keys/:id/rate-limit", async (request, reply) => {
    try {
      const parsed = updateRateLimitSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }

      const key = await updateApiKeyRateLimit(request.user.id, request.params.id, parsed.data.rateLimitPerMinute);
      return reply.send({ key });
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
}
