import type { FastifyInstance } from "fastify";
import type { OutgoingHttpHeaders } from "node:http";
import { z } from "zod";
import { isProviderId, type ChatJobPayload, type ErrorCode, type ProviderId } from "@uaiw/shared/types/provider.js";
import { attachLocalUser } from "../middleware/auth.js";
import { enqueueChatJob, getChatBullJobState, removeQueuedChatJob } from "../services/chatQueue.js";
import { requestJobCancel } from "../services/cancelSignal.js";
import { prisma } from "../services/prisma.js";
import { providerRegistry } from "../services/providerRegistry.js";
import { RedisJobEventSubscriber } from "../services/redisJobEventBus.js";
import { publishDone, publishJobEvent } from "../services/redisJobEventPublisher.js";
import { validateRunnableProvider, createJob, findOwnedJob, parseStoredPayload, enqueueCreatedJob, resolveThreadId, resolveThreadConversationUrl, type ProviderItemError } from "../services/chatJobService.js";
import { getModelPreferences } from "../services/modelPreferenceService.js";
import {
  checkProviderRateLimit,
  providerRateLimitHeaders,
  ProviderRateLimitExceededError
} from "../services/providerRateLimitService.js";
import { logProviderRateLimitHit, modelIdForProvider } from "../services/apiUsageService.js";
import {
  createAttachment,
  resolveOwnedAttachmentIds,
  cloneAttachmentsForJob,
  deleteAttachments,
  AttachmentValidationError,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES
} from "../services/attachmentService.js";

const MAX_PROMPT_LENGTH = 20_000;

const attachmentIdsField = z.array(z.string()).max(MAX_ATTACHMENTS_PER_MESSAGE).optional();

const chatBody = z.object({
  provider: z.string(),
  threadId: z.string().optional(),
  prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
  saveHistory: z.boolean().default(true),
  attachmentIds: attachmentIdsField
});

const multiChatBody = z.object({
  providers: z.array(z.string()).min(1).max(3),
  threadId: z.string().optional(),
  prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
  saveHistory: z.boolean().default(true),
  attachmentIds: attachmentIdsField
});

const uploadBody = z.object({
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(200),
  // Allow empty here so the service returns a clean 400 ("Attachment is empty")
  // instead of a raw Zod 500.
  contentBase64: z.string()
});

const redisEvents = new RedisJobEventSubscriber();
const CANCELLABLE_STATUSES = new Set(["queued", "running", "streaming"]);
const RETRYABLE_STATUSES = new Set(["failed", "cancelled", "timeout", "requires_login", "manual_action_required"]);



export async function chatRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  // Base64 JSON upload (no multipart dep). Generous body limit so a ~10 MB file
  // survives base64 inflation; the chat job payload only carries attachment IDs.
  app.post("/chat/uploads", { bodyLimit: Math.ceil(MAX_ATTACHMENT_BYTES * 1.4) + 1024 }, async (request, reply) => {
    const body = uploadBody.parse(request.body);
    try {
      const attachment = await createAttachment({
        userId: request.user.id,
        filename: body.filename,
        mimeType: body.mimeType,
        contentBase64: body.contentBase64
      });
      return reply.send(attachment);
    } catch (error) {
      if (error instanceof AttachmentValidationError) {
        const status =
          error.code === "payload_too_large" ? 413 : error.code === "unsupported_media_type" ? 415 : 400;
        return reply.code(status).send({ errorCode: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.post("/chat", async (request, reply) => {
    const body = chatBody.parse(request.body);

    const providerCheck = await validateRunnableProvider(request.user.id, body.provider);
    if (!providerCheck.ok) {
      const status = providerCheck.error.errorCode === "PROVIDER_NOT_READY" ? 501 : 409;
      return reply.code(status).send(providerCheck.error);
    }
    try {
      const rate = await checkProviderRateLimit(request.user.id, providerCheck.provider);
      reply.headers(providerRateLimitHeaders(rate));
    } catch (error) {
      if (error instanceof ProviderRateLimitExceededError) {
        await logProviderRateLimitHit({
          userId: request.user.id,
          provider: providerCheck.provider,
          modelId: modelIdForProvider(providerCheck.provider),
          source: "internal_chat",
          limitPerMinute: error.check.limit
        });
        reply.headers(providerRateLimitHeaders(error.check));
        return reply.code(429).send({
          provider: providerCheck.provider,
          errorCode: "PROVIDER_RATE_LIMIT_EXCEEDED",
          message: "Provider rate limit exceeded.",
          limit: error.check.limit,
          remaining: error.check.remaining,
          resetAt: error.check.resetAt
        });
      }
      return reply.code(503).send({
        provider: providerCheck.provider,
        errorCode: "PROVIDER_RATE_LIMIT_UNAVAILABLE",
        message: "Provider rate limit check is unavailable. Is Redis running?"
      });
    }

    const threadId = await resolveThreadId({
      userId: request.user.id,
      threadId: body.threadId,
      prompt: body.prompt,
      saveHistory: body.saveHistory
    });
    const prefs = await getModelPreferences(request.user.id);
    const pref = prefs.models.find(m => m.provider === providerCheck.provider);

    const job = await createJob({
      userId: request.user.id,
provider: providerCheck.provider,
      threadId,
      prompt: body.prompt,
      saveHistory: body.saveHistory,
      selectedSubModelId: pref?.selectedSubModelId,
      selectedSubModelLabel: pref?.selectedSubModelLabel
    });

    if (body.saveHistory && threadId) {
      await prisma.message.create({
        data: {
          userId: request.user.id,
          threadId,
          provider: body.provider,
          role: "user",
          content: body.prompt,
          metadataJson: JSON.stringify({ jobId: job.id })
        }
      });
    }

    const conversationUrl = threadId
      ? await resolveThreadConversationUrl(threadId, providerCheck.provider)
      : undefined;

    const ownedAttachmentIds = body.attachmentIds?.length
      ? await resolveOwnedAttachmentIds(request.user.id, body.attachmentIds)
      : [];
    const jobAttachmentIds = ownedAttachmentIds.length
      ? await cloneAttachmentsForJob(request.user.id, ownedAttachmentIds)
      : undefined;

    const enqueueError = await enqueueCreatedJob({
      jobId: job.id,
      userId: request.user.id,
provider: providerCheck.provider,
      threadId,
      prompt: body.prompt,
      saveHistory: body.saveHistory,
      persistUserMessage: false,
      conversationUrl,
      attachmentIds: jobAttachmentIds
    });
    await deleteAttachments(ownedAttachmentIds);
    if (enqueueError) {
      // Job never enqueued → its cloned attachments would never be consumed.
      if (jobAttachmentIds?.length) await deleteAttachments(jobAttachmentIds);
      return reply.code(503).send(enqueueError);
    }

    return reply.send({
      jobId: job.id,
      threadId,
      streamUrl: `/chat/${job.id}/stream`
    });
  });

  app.post("/chat/multi", async (request, reply) => {
    const body = multiChatBody.parse(request.body);
    const providers = [...new Set(body.providers)];

    const checks = await Promise.all(
      providers.map(async (provider) => validateRunnableProvider(request.user.id, provider))
    );

    const validated = checks.filter((check): check is { ok: true; provider: ProviderId } => check.ok);
    const errors = checks
      .filter((check): check is { ok: false; error: ProviderItemError } => !check.ok)
      .map((check) => check.error);

    const limitCheckTasks: Array<Promise<{ ok: true; provider: ProviderId } | { ok: false; error: ProviderItemError }>> =
      validated.map(async (item) => {
        try {
          await checkProviderRateLimit(request.user.id, item.provider);
          return { ok: true as const, provider: item.provider };
        } catch (error) {
          if (error instanceof ProviderRateLimitExceededError) {
            await logProviderRateLimitHit({
          userId: request.user.id,
          provider: item.provider,
              modelId: modelIdForProvider(item.provider),
              source: "internal_multi_chat",
              limitPerMinute: error.check.limit
            });
            return {
              ok: false as const,
              error: {
                provider: item.provider,
                errorCode: "PROVIDER_RATE_LIMIT_EXCEEDED" as const,
                message: "Provider rate limit exceeded."
              }
            };
          }
          throw error;
        }
      });
    const limitChecks = await Promise.all(limitCheckTasks).catch(() => null);

    if (!limitChecks) {
      return reply.code(503).send({
        errorCode: "PROVIDER_RATE_LIMIT_UNAVAILABLE",
        message: "Provider rate limit check is unavailable. Is Redis running?",
        jobs: [],
        errors
      });
    }

    const runnable = limitChecks.filter((check): check is { ok: true; provider: ProviderId } => check.ok);
    errors.push(
      ...limitChecks
        .filter((check): check is { ok: false; error: ProviderItemError } => !check.ok)
        .map((check) => check.error)
    );

    if (runnable.length === 0) {
      return reply.code(409).send({
        errorCode: "PROVIDER_NOT_READY",
        message: "No selected provider is chat-ready.",
        jobs: [],
        errors
      });
    }

    const threadId = await resolveThreadId({
      userId: request.user.id,
      threadId: body.threadId,
      prompt: body.prompt,
      saveHistory: body.saveHistory
    });

    if (body.saveHistory && threadId) {
      await prisma.message.create({
        data: {
          userId: request.user.id,
          threadId,
          provider: null,
          role: "user",
          content: body.prompt,
          metadataJson: JSON.stringify({ mode: "multi_provider", providers: runnable.map((item) => item.provider) })
        }
      });
    }

    const ownedAttachmentIds = body.attachmentIds?.length
      ? await resolveOwnedAttachmentIds(request.user.id, body.attachmentIds)
      : [];

    const prefs = await getModelPreferences(request.user.id);
    const jobs = await Promise.all(
      runnable.map(async ({ provider }) => {
        const pref = prefs.models.find(m => m.provider === provider);
        const job = await createJob({
          userId: request.user.id,
          provider,
          threadId,
          prompt: body.prompt,
          saveHistory: body.saveHistory,
          selectedSubModelId: pref?.selectedSubModelId,
          selectedSubModelLabel: pref?.selectedSubModelLabel
        });

        const conversationUrl = threadId
          ? await resolveThreadConversationUrl(threadId, provider)
          : undefined;

        // Each provider gets its own clone so per-job cleanup never races siblings.
        const jobAttachmentIds = ownedAttachmentIds.length
          ? await cloneAttachmentsForJob(request.user.id, ownedAttachmentIds)
          : undefined;

        const enqueueError = await enqueueCreatedJob({
          jobId: job.id,
          userId: request.user.id,
          provider,
          threadId,
          prompt: body.prompt,
          saveHistory: body.saveHistory,
          persistUserMessage: false,
          conversationUrl,
          attachmentIds: jobAttachmentIds
        });

        if (enqueueError) {
          // The job never reached the worker, so its cloned attachments would
          // otherwise never be consumed/deleted — clean them up now.
          if (jobAttachmentIds?.length) await deleteAttachments(jobAttachmentIds);
          return {
            provider,
            error: enqueueError
          };
        }

        return {
          provider,
          jobId: job.id,
          streamUrl: `/chat/${job.id}/stream`
        };
      })
    );

    await deleteAttachments(ownedAttachmentIds);

    const queuedJobs = jobs.filter((item): item is { provider: ProviderId; jobId: string; streamUrl: string } => !("error" in item));
    const enqueueErrors = jobs
      .filter((item): item is { provider: ProviderId; error: ProviderItemError } => "error" in item)
      .map((item) => item.error);

    if (queuedJobs.length === 0) {
      return reply.code(409).send({
        errorCode: "CHAT_JOB_FAILED",
        message: "No selected provider could be enqueued.",
        jobs: [],
        errors: [...errors, ...enqueueErrors]
      });
    }

    return reply.send({ threadId, jobs: queuedJobs, errors: [...errors, ...enqueueErrors] });
  });

  app.get("/chat/:jobId/stream", async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);

    const job = await prisma.automationJob.findFirst({
      where: { id: jobId, userId: request.user.id }
    });

    if (!job) {
      return reply.code(404).send({
        errorCode: "JOB_NOT_FOUND",
        message: "Chat job was not found."
      });
    }

    // reply.getHeaders() can include numeric values (e.g. content-length) which
    // TS rejects against the named keys of OutgoingHttpHeaders even though Node
    // accepts them at runtime. Cast through unknown for this header plumbing.
    const sseHeaders = {
      ...reply.getHeaders(),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    } as unknown as OutgoingHttpHeaders;
    reply.raw.writeHead(200, sseHeaders);

    let finished = false;
    const send = (event: string, data: unknown) => {
      if (finished) return;
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const pingInterval = setInterval(() => {
      send("ping", { timestamp: Date.now() });
    }, 5000);

    let unsubscribe: (() => Promise<void>) | undefined;
    // Idempotent teardown: safe to call whether or not `unsubscribe` has been
    // assigned yet. Critical because subscribe() replays buffered events
    // synchronously before it returns the handle — a terminal replayed event
    // (attaching to an already-finished job) must not leave the Redis
    // subscriber connection dangling.
    const teardown = () => {
      if (finished) return;
      finished = true;
      clearInterval(pingInterval);
      void unsubscribe?.();
      reply.raw.end();
    };

    const TERMINAL = new Set(["done", "error", "requires_login", "manual_action_required", "rate_limited", "cancelled", "timeout"]);

    send("connected", { jobId });

    unsubscribe = await redisEvents.subscribe(jobId, (event) => {
      if (finished) return;
      send(event.type, event);
      if (TERMINAL.has(event.type)) teardown();
    });

    // If a replayed terminal event finished the stream during subscribe(),
    // `unsubscribe` was undefined inside teardown — release it now.
    if (finished) {
      void unsubscribe?.();
    } else {
      request.raw.on("close", () => {
        finished = true;
        clearInterval(pingInterval);
        void unsubscribe?.();
      });
    }
  });

  app.get("/chat/:jobId/status", async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const job = await findOwnedJob(jobId, request.user.id);
    if (!job) {
      return reply.code(404).send({ errorCode: "JOB_NOT_FOUND", message: "Chat job was not found." });
    }

    let bullmqState: string | null = null;
    let queueWarning: string | null = null;
    try {
      bullmqState = await getChatBullJobState(jobId);
    } catch {
      queueWarning = "Unable to read queue state. Is Redis running?";
    }

    return reply.send({
      jobId: job.id,
      provider: job.provider,
      threadId: job.threadId,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      errorCode: job.errorCode,
      errorMessage: job.errorMessageSafe,
      bullmqState,
      queueWarning
    });
  });

  app.post("/chat/:jobId/cancel", async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const job = await findOwnedJob(jobId, request.user.id);
    if (!job) {
      return reply.code(404).send({ errorCode: "JOB_NOT_FOUND", message: "Chat job was not found." });
    }

    if (!CANCELLABLE_STATUSES.has(job.status)) {
      return reply.code(409).send({
        errorCode: "JOB_NOT_CANCELLABLE",
        message: "This job can no longer be cancelled."
      });
    }

    await requestJobCancel(jobId);
    await removeQueuedChatJob(jobId).catch(() => false);
    await prisma.automationJob.update({
      where: { id: jobId },
      data: {
        status: "cancelled",
        completedAt: new Date(),
        errorCode: "JOB_CANCELLED",
        errorMessageSafe: "Job was cancelled."
      }
    });

    if (isProviderId(job.provider)) {
      await publishJobEvent(jobId, {
        type: "cancelled",
        provider: job.provider,
        jobId,
        message: "Job was cancelled."
      });
      await publishDone(jobId, job.provider);
    }

    return reply.send({ jobId, status: "cancelled" });
  });

  app.post("/chat/:jobId/retry", async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const jobToRetry = await findOwnedJob(jobId, request.user.id);
    if (!jobToRetry) {
      return reply.code(404).send({ errorCode: "JOB_NOT_FOUND", message: "Chat job was not found." });
    }

    if (!RETRYABLE_STATUSES.has(jobToRetry.status)) {
      return reply.code(409).send({
        errorCode: "JOB_NOT_RETRYABLE",
        message: "This job is not retryable."
      });
    }

    const payload = parseStoredPayload(jobToRetry.inputJson);
    if (!payload || !isProviderId(jobToRetry.provider)) {
      return reply.code(409).send({
        errorCode: "JOB_NOT_RETRYABLE",
        message: "This job does not contain enough safe metadata to retry."
      });
    }

    const providerCheck = await validateRunnableProvider(request.user.id, jobToRetry.provider);
    if (!providerCheck.ok) {
      return reply.code(409).send(providerCheck.error);
    }
    try {
      const rate = await checkProviderRateLimit(request.user.id, providerCheck.provider);
      reply.headers(providerRateLimitHeaders(rate));
    } catch (error) {
      if (error instanceof ProviderRateLimitExceededError) {
        await logProviderRateLimitHit({
          userId: request.user.id,
          provider: providerCheck.provider,
          modelId: modelIdForProvider(providerCheck.provider),
          source: "internal_retry",
          limitPerMinute: error.check.limit
        });
        reply.headers(providerRateLimitHeaders(error.check));
        return reply.code(429).send({
          provider: providerCheck.provider,
          errorCode: "PROVIDER_RATE_LIMIT_EXCEEDED",
          message: "Provider rate limit exceeded.",
          limit: error.check.limit,
          remaining: error.check.remaining,
          resetAt: error.check.resetAt
        });
      }
      return reply.code(503).send({
        provider: providerCheck.provider,
        errorCode: "PROVIDER_RATE_LIMIT_UNAVAILABLE",
        message: "Provider rate limit check is unavailable. Is Redis running?"
      });
    }

    const prefs = await getModelPreferences(request.user.id);
    const pref = prefs.models.find(m => m.provider === jobToRetry.provider);

    const retryJob = await createJob({
      userId: request.user.id,
provider: providerCheck.provider,
      threadId: jobToRetry.threadId,
      prompt: payload.prompt,
      saveHistory: payload.saveHistory,
      retryOfJobId: jobToRetry.id,
      selectedSubModelId: pref?.selectedSubModelId,
      selectedSubModelLabel: pref?.selectedSubModelLabel
    });

    const retryConversationUrl = jobToRetry.threadId
      ? await resolveThreadConversationUrl(jobToRetry.threadId, providerCheck.provider)
      : undefined;

    const enqueueError = await enqueueCreatedJob({
      jobId: retryJob.id,
      userId: request.user.id,
provider: providerCheck.provider,
      threadId: jobToRetry.threadId,
      prompt: payload.prompt,
      saveHistory: payload.saveHistory,
      persistUserMessage: false,
      selectedSubModelId: pref?.selectedSubModelId,
      selectedSubModelLabel: pref?.selectedSubModelLabel,
      conversationUrl: retryConversationUrl
    });
    if (enqueueError) return reply.code(503).send(enqueueError);

    await publishJobEvent(jobToRetry.id, {
      type: "retrying",
      provider: providerCheck.provider,
      jobId: retryJob.id,
      retryOfJobId: jobToRetry.id
    });

    return reply.send({
      jobId: retryJob.id,
      retryOfJobId: jobToRetry.id,
      threadId: jobToRetry.threadId,
      streamUrl: `/chat/${retryJob.id}/stream`
    });
  });
}
