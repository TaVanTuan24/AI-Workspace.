import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { internalApiAuth } from "../middleware/internalApiAuth.js";
import { internalApiRateLimit } from "../services/rateLimiter.js";
import { validateRunnableProvider, createJob, resolveThreadId, enqueueCreatedJob } from "../services/chatJobService.js";
import { env } from "../config/env.js";
import { mapInternalErrorToOpenAI } from "../services/openaiCompatErrors.js";
import { RedisJobEventSubscriber } from "../services/redisJobEventBus.js";
import { prisma } from "../services/prisma.js";
import { createUsageStart, completeUsageError, completeUsageSuccess, logProviderRateLimitHit } from "../services/apiUsageService.js";
import { getProviderHealth } from "../services/providerHealthService.js";
import { getModelPreferences, getModelTemporaryDisable, isModelEnabled } from "../services/modelPreferenceService.js";
import { getCachedLiveSubModels } from "../services/providerLiveSubModelService.js";
import { isModelAllowedForApiKey } from "../services/apiKeyService.js";
import { OPENAI_COMPAT_MODELS, convertMessagesToPrompt } from "../services/openaiCompatModels.js";
import {
  checkProviderRateLimit,
  providerRateLimitHeaders,
  ProviderRateLimitExceededError
} from "../services/providerRateLimitService.js";

const redisEvents = new RedisJobEventSubscriber();

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string()
});

const chatCompletionsBody = z.object({
  model: z.string(),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().default(false),
  temperature: z.number().optional(),
  max_tokens: z.number().optional()
});

export async function openaiCompatRoutes(app: FastifyInstance) {
  app.addHook("preHandler", internalApiAuth);
  app.addHook("preHandler", internalApiRateLimit);

  app.get("/v1/models", async (request, reply) => {
    // Note: GET /v1/models is currently authorized via preHandler hooks
    // request.user is guaranteed because of internalApiAuth
    
    const prefs = await getModelPreferences(request.user.id);
    
    // Filter models if DB key has restricted scopes
    const apiKeyId = request.apiKeyId;
    let allowedModelIds: Set<string> | null = null;
    if (apiKeyId) {
      const { getApiKeyModelScopes } = await import("../services/apiKeyService.js");
      const scopes = await getApiKeyModelScopes(apiKeyId);
      if (scopes.length > 0) {
        allowedModelIds = new Set(scopes);
      }
    }

    const liveCaches = await getCachedLiveSubModels(request.user.id);
    const liveCachesMap = new Map(liveCaches.map(c => [c.provider, c]));

    const models = prefs.models
      .filter(pref => {
        if (!allowedModelIds) return true;
        return allowedModelIds.has(pref.modelId);
      })
      .map(pref => {
        const liveCache = liveCachesMap.get(pref.provider);
        return {
          id: pref.modelId,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "unified-ai-workspace",
          metadata: {
            provider: pref.provider,
            type: "browser_automation_bridge",
            enabled: pref.enabled,
            default: pref.isDefault,
            priority: pref.priority,
            readiness: pref.readiness,
            capabilities: pref.capabilities,
            connectionStatus: pref.healthStatus, // For backwards compat if needed, but prefer healthStatus
            healthStatus: pref.healthStatus,
            requiresLogin: pref.requiresLogin,
            isUsable: pref.isUsable,
            lastValidatedAt: null, // We don't have lastValidatedAt directly in ModelPreferenceView, but it's okay for now.
            allowedByKey: true,
            selectedSubModelId: pref.selectedSubModelId,
            selectedSubModelLabel: pref.selectedSubModelLabel,
            recovery: {
              providerDegraded: pref.recovery.providerDegraded,
              temporarilyDisabled: pref.recovery.temporarilyDisabled,
              disabledUntil: pref.recovery.disabledUntil ?? null,
              disabledReason: pref.recovery.disabledReason ?? null,
              degradedUntil: pref.recovery.degradedUntil ?? null,
              degradedReason: pref.recovery.degradedReason ?? null,
              degradedMode: pref.recovery.degradedMode ?? null
            },
            subModels: {
              static: pref.subModels || [],
              live: liveCache?.subModels || [],
              liveDetectedAt: liveCache?.detectedAt || null
            }
          }
        };
      });

    return reply.send({
      object: "list",
      data: models
    });
  });

  app.post("/v1/chat/completions", async (request, reply) => {
    const parsed = chatCompletionsBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          code: "invalid_request"
        }
      });
    }

    const { model, messages, stream } = parsed.data;

    const messageCount = messages.length;
    const inputCharCount = messages.reduce((acc, m) => acc + m.content.length, 0);
    const startedAt = Date.now();

    const modelDef = OPENAI_COMPAT_MODELS[model];
    
    const usageLog = await createUsageStart({
      userId: request.user.id,
      workspaceId: request.user.workspaceId!,
      apiKeyId: request.apiKeyId,
      apiKeyPrefix: request.apiKeyPrefix,
      model,
      provider: modelDef?.provider || "unknown",
      endpoint: request.url,
      requestId: request.id,
      stream,
      messageCount,
      inputCharCount
    }).catch(() => null);

    if (!modelDef) {
      if (usageLog) await completeUsageError(usageLog.id, { errorCode: "UNKNOWN_PROVIDER", durationMs: Date.now() - startedAt });
      return reply.code(400).send(mapInternalErrorToOpenAI("UNKNOWN_PROVIDER", "Model not found."));
    }

    const temporaryDisable = await getModelTemporaryDisable(request.user.id, model);
    if (temporaryDisable) {
      if (usageLog) {
        await completeUsageError(usageLog.id, {
          errorCode: "MODEL_TEMPORARILY_DISABLED",
          errorType: "invalid_request_error",
          durationMs: Date.now() - startedAt,
          status: "failed"
        });
      }
      return reply.code(400).send({
        error: {
          message: `Model is temporarily disabled by a recovery policy until ${temporaryDisable.until}.`,
          type: "invalid_request_error",
          code: "model_temporarily_disabled"
        }
      });
    }

    const enabled = await isModelEnabled(request.user.id, model);
    if (!enabled) {
      if (usageLog) await completeUsageError(usageLog.id, { errorCode: "MODEL_DISABLED", durationMs: Date.now() - startedAt });
      return reply.code(403).send({
        error: {
          message: `Model ${model} is disabled in workspace settings.`,
          type: "invalid_request_error",
          code: "model_disabled"
        }
      });
    }

    if (request.apiKeyId) {
      const allowed = await isModelAllowedForApiKey(request.apiKeyId, model);
      if (!allowed) {
        if (usageLog) await completeUsageError(usageLog.id, { errorCode: "MODEL_NOT_ALLOWED_FOR_KEY", durationMs: Date.now() - startedAt });
        return reply.code(403).send({
          error: {
            message: `Model ${model} is not allowed for this API key.`,
            type: "invalid_request_error",
            code: "model_not_allowed_for_key"
          }
        });
      }
    }

    try {
      const rate = await checkProviderRateLimit(request.user.id, modelDef.provider);
      reply.headers(providerRateLimitHeaders(rate));
    } catch (error) {
      if (error instanceof ProviderRateLimitExceededError) {
        await logProviderRateLimitHit({
          userId: request.user.id,
          workspaceId: request.user.workspaceId!,
          provider: modelDef.provider,
          modelId: model,
          source: "openai_compat",
          limitPerMinute: error.check.limit,
          apiKeyId: request.apiKeyId,
          apiKeyPrefix: request.apiKeyPrefix,
          usageLogId: usageLog?.id
        });
        reply.headers(providerRateLimitHeaders(error.check));
        return reply.code(429).send({
          error: {
            message: "Provider rate limit exceeded.",
            type: "rate_limit_error",
            code: "provider_rate_limit_exceeded",
            provider: modelDef.provider
          }
        });
      }
      if (usageLog) {
        await completeUsageError(usageLog.id, {
          errorCode: "PROVIDER_RATE_LIMIT_UNAVAILABLE",
          errorType: "server_error",
          durationMs: Date.now() - startedAt,
          status: "failed"
        });
      }
      return reply.code(503).send({
        error: {
          message: "Provider rate limit check is unavailable.",
          type: "server_error",
          code: "provider_rate_limit_unavailable",
          provider: modelDef.provider
        }
      });
    }

    const providerCheck = await validateRunnableProvider(request.user.id, modelDef.provider);
    if (!providerCheck.ok) {
      if (usageLog) await completeUsageError(usageLog.id, { errorCode: providerCheck.error.errorCode, durationMs: Date.now() - startedAt, status: "requires_login" });
      return reply.code(409).send(mapInternalErrorToOpenAI(providerCheck.error.errorCode, providerCheck.error.message));
    }

    const prompt = convertMessagesToPrompt(messages);
    const saveHistory = env.INTERNAL_API_SAVE_HISTORY;

    const threadId = await resolveThreadId({
      userId: request.user.id,
      prompt,
      saveHistory
    });

    const job = await createJob({
      userId: request.user.id,
      provider: providerCheck.provider,
      threadId,
      prompt,
      saveHistory
    });

    if (saveHistory && threadId) {
      await prisma.message.create({
        data: {
          userId: request.user.id,
          threadId,
          provider: providerCheck.provider,
          role: "user",
          content: prompt,
          metadataJson: JSON.stringify({ jobId: job.id, source: "internal_api" })
        }
      });
    }

    const enqueueError = await enqueueCreatedJob({
      jobId: job.id,
      userId: request.user.id,
      provider: providerCheck.provider,
      threadId,
      prompt,
      saveHistory,
      persistUserMessage: false
    });

    if (enqueueError) {
      if (usageLog) await completeUsageError(usageLog.id, { errorCode: enqueueError.errorCode, durationMs: Date.now() - startedAt });
      return reply.code(503).send(mapInternalErrorToOpenAI(enqueueError.errorCode, enqueueError.message));
    }

    if (!stream) {
      return new Promise((resolve) => {
        let finalResponse = "";
        let hasError = false;
        
        const timeout = setTimeout(() => {
          hasError = true;
          void unsubscribe?.();
          if (usageLog) void completeUsageError(usageLog.id, { errorCode: "TIMEOUT", durationMs: Date.now() - startedAt, jobId: job.id, status: "timeout" });
          resolve(reply.code(504).send(mapInternalErrorToOpenAI("TIMEOUT", "Provider took too long to respond.")));
        }, env.OPENAI_COMPAT_NONSTREAM_TIMEOUT_MS);

        let unsubscribe: (() => Promise<void>) | undefined;
        redisEvents.subscribe(job.id, (event) => {
          if (hasError) return;
          
          if (event.type === "message_complete") {
            finalResponse = event.text || "";
          } else if (event.type === "error" || event.type === "requires_login" || event.type === "manual_action_required" || event.type === "rate_limited") {
            hasError = true;
            clearTimeout(timeout);
            void unsubscribe?.();
            if (usageLog) void completeUsageError(usageLog.id, { errorCode: event.type.toUpperCase(), durationMs: Date.now() - startedAt, jobId: job.id, status: event.type === "rate_limited" ? "rate_limited" : "failed" });
            resolve(reply.code(500).send(mapInternalErrorToOpenAI(event.type.toUpperCase(), event.message || "Provider error occurred.")));
          } else if (event.type === "done") {
            clearTimeout(timeout);
            void unsubscribe?.();
            if (usageLog) void completeUsageSuccess(usageLog.id, { outputCharCount: finalResponse.length, durationMs: Date.now() - startedAt, jobId: job.id });
            
            resolve(reply.send({
              id: `chatcmpl_${job.id}`,
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: finalResponse
                  },
                  finish_reason: "stop"
                }
              ],
              usage: null,
              metadata: {
                provider: providerCheck.provider,
                backend: "browser_automation_bridge",
                jobId: job.id
              }
            }));
          }
        }).then(unsub => {
          unsubscribe = unsub;
          if (hasError || finalResponse) {
            void unsubscribe();
          }
        });
      });
    } else {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });

      const sendChunk = (delta: any, finishReason: string | null = null) => {
        const chunk = {
          id: `chatcmpl_${job.id}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              delta,
              finish_reason: finishReason
            }
          ]
        };
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
      };

      sendChunk({ role: "assistant", content: "" }); // Initial role chunk

      let finalLength = 0;
      let hasCompleted = false;

      let unsubscribe: (() => Promise<void>) | undefined;
      unsubscribe = await redisEvents.subscribe(job.id, (event) => {
        if (event.type === "message_delta") {
          finalLength += event.text.length;
          sendChunk({ content: event.text });
        } else if (event.type === "error" || event.type === "requires_login" || event.type === "manual_action_required" || event.type === "rate_limited") {
          hasCompleted = true;
          if (usageLog) void completeUsageError(usageLog.id, { errorCode: event.type.toUpperCase(), durationMs: Date.now() - startedAt, jobId: job.id, status: event.type === "rate_limited" ? "rate_limited" : "failed" });
          const errPayload = mapInternalErrorToOpenAI(event.type.toUpperCase(), event.message || "Provider error occurred.");
          reply.raw.write(`data: ${JSON.stringify(errPayload)}\n\n`);
          reply.raw.write(`data: [DONE]\n\n`);
          void unsubscribe?.();
          reply.raw.end();
        } else if (event.type === "done" || event.type === "cancelled" || event.type === "timeout") {
          hasCompleted = true;
          if (usageLog) {
            if (event.type === "done") {
              void completeUsageSuccess(usageLog.id, { outputCharCount: finalLength, durationMs: Date.now() - startedAt, jobId: job.id });
            } else {
              void completeUsageError(usageLog.id, { errorCode: event.type.toUpperCase(), durationMs: Date.now() - startedAt, jobId: job.id, status: event.type });
            }
          }
          sendChunk({}, "stop");
          reply.raw.write(`data: [DONE]\n\n`);
          void unsubscribe?.();
          reply.raw.end();
        }
      });

      request.raw.on("close", () => {
        if (!hasCompleted && usageLog) {
          void completeUsageError(usageLog.id, { errorCode: "CLIENT_DISCONNECTED", durationMs: Date.now() - startedAt, jobId: job.id, status: "client_disconnected" });
        }
        void unsubscribe?.();
      });
    }
  });
}
