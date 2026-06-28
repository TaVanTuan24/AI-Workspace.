import type { FastifyReply, FastifyRequest } from "fastify";
import crypto from "crypto";
import { env } from "../config/env.js";
import { attachLocalUser } from "./auth.js";
import { verifyApiKey, markLastUsed } from "../services/apiKeyService.js";

export async function internalApiAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return reply.code(401).send({
      error: {
        message: "Missing or invalid Authorization header.",
        type: "authentication_error",
        code: "invalid_api_key"
      }
    });
  }

  const token = authHeader.substring("Bearer ".length).trim();

  // 1. Try DB key if enabled
  if (env.ENABLE_DB_API_KEYS) {
    const dbKey = await verifyApiKey(token);
    if (dbKey) {
      // Attach local user context so job ownership works
      await attachLocalUser(request);
      request.apiKeyId = dbKey.keyId;
      request.apiKeyPrefix = dbKey.keyPrefix;
      request.rateLimitPerMinute = dbKey.rateLimitPerMinute;
      // Mark as used
      void markLastUsed(dbKey.keyId);
      return;
    }
  }

  // 2. Fallback to ENV key
  const validKey = env.INTERNAL_API_KEY;
  if (!validKey) {
    return reply.code(401).send({
      error: {
        message: "Invalid API key.",
        type: "authentication_error",
        code: "invalid_api_key"
      }
    });
  }

  const isValid =
    token.length === validKey.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(validKey));

  if (!isValid) {
    return reply.code(401).send({
      error: {
        message: "Invalid API key.",
        type: "authentication_error",
        code: "invalid_api_key"
      }
    });
  }

  request.apiKeyPrefix = "env_fallback";
  await attachLocalUser(request);
}
