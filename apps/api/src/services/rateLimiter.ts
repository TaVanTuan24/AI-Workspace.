import { chatQueueConnection } from "./chatQueue.js";
import { env } from "../config/env.js";
import type { FastifyReply, FastifyRequest } from "fastify";

import { logRateLimitHit } from "./apiUsageService.js";
import { OPENAI_COMPAT_MODELS } from "./openaiCompatModels.js";

export async function internalApiRateLimit(request: FastifyRequest, reply: FastifyReply) {
  const prefixOrId = request.apiKeyId || request.apiKeyPrefix || "unknown";

  const now = new Date();
  
  const yyyy = now.getUTCFullYear();
  const MM = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const HH = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const minuteKey = `${yyyy}${MM}${dd}${HH}${mm}`;
  
  const redisKey = `internal-api-rate:${prefixOrId}:${minuteKey}`;

  const current = await chatQueueConnection.incr(redisKey);
  
  if (current === 1) {
    await chatQueueConnection.expire(redisKey, 60);
  }

  const limit = request.rateLimitPerMinute ?? env.INTERNAL_API_RATE_LIMIT_PER_MINUTE;

  reply.header("X-RateLimit-Limit", limit);
  reply.header("X-RateLimit-Remaining", Math.max(0, limit - current));
  const resetUnix = Math.floor(now.getTime() / 1000) + (60 - now.getUTCSeconds());
  reply.header("X-RateLimit-Reset", resetUnix);

  if (current > limit) {
    if (request.user?.id) {
      const body = request.body as any;
      const model = body?.model || "unknown";
      const provider = OPENAI_COMPAT_MODELS[model]?.provider || "unknown";
      
      await logRateLimitHit({
        userId: request.user.id,
workspaceId: request.user.workspaceId!,
apiKeyId: request.apiKeyId,
        apiKeyPrefix: request.apiKeyPrefix,
        model,
        provider,
        endpoint: request.url,
        requestId: request.id
      });
    }

    return reply.code(429).send({
      error: {
        message: "Rate limit exceeded.",
        type: "rate_limit_error",
        code: "rate_limit_exceeded"
      }
    });
  }
}
