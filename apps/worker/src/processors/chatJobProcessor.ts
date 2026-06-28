import type { Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import type { ChatJobPayload, ErrorCode, ProviderEvent, ProviderId } from "@uaiw/shared/types/provider.js";
import { AesGcmSessionVault, type EncryptedSession } from "@uaiw/session-vault/index.js";
import { BrowserManager } from "../browser/BrowserManager.js";
import { providerRegistry } from "../providers/registry.js";
import { RedisConcurrencyLock, chatLockKey } from "../services/concurrencyLock.js";
import { RedisJobEventPublisher } from "../services/redisJobEventPublisher.js";
import { workerRedis } from "../services/chatQueue.js";
import { isJobCancelled, throwIfCancelled } from "../services/cancelSignal.js";
import { env } from "../config/env.js";

const prisma = new PrismaClient();
const vault = new AesGcmSessionVault();
const browserManager = new BrowserManager();
const publisher = new RedisJobEventPublisher(workerRedis);
const lock = new RedisConcurrencyLock(workerRedis);
const LOCK_TTL_MS = 1000 * 60 * 5;

export async function chatJobProcessor(job: Job<ChatJobPayload>) {
  const input = job.data;
  if (await isJobCancelled(input.jobId)) {
    await cancelJob(input);
    return;
  }

  const lockKey = chatLockKey(input.userId, input.provider);
  const lockToken = await lock.acquire(lockKey, LOCK_TTL_MS);

  if (!lockToken) {
    await failJob(input, "PROVIDER_BUSY", "This provider is already processing another request. Please try again shortly.");
    return;
  }

  try {
    await throwIfCancelled(input.jobId);
    await processChatJob(input);
  } catch (error) {
    if (error instanceof Error && error.message === "JOB_CANCELLED") {
      await cancelJob(input);
      return;
    }
    throw error;
  } finally {
    await lock.release(lockKey, lockToken).catch(() => false);
  }
}

async function processChatJob(input: ChatJobPayload): Promise<void> {
  let finalText = "";
  const deadline = Date.now() + env.CHAT_JOB_TIMEOUT_MS;

  try {
    checkJobTimeout(deadline);
    await throwIfCancelled(input.jobId);
    const registered = providerRegistry.get(input.provider);
    providerRegistry.assertCapability(input.provider, "send_message");

    await prisma.automationJob.update({
      where: { id: input.jobId },
      data: { status: "running", startedAt: new Date() }
    });

    await publisher.publish(input.jobId, {
      type: "started",
      provider: input.provider,
      jobId: input.jobId
    });

    checkJobTimeout(deadline);
    await throwIfCancelled(input.jobId);
    const connection = await prisma.providerConnection.findUnique({
      where: { userId_provider: { userId: input.userId, provider: input.provider } }
    });

    if (!connection || connection.status !== "connected" || !connection.encryptedSessionBlob) {
      await markRequiresLogin(input);
      return;
    }

    let sessionState: unknown;
    try {
      sessionState = await vault.decryptSession({
        userId: input.userId,
        provider: input.provider,
        blob: JSON.parse(connection.encryptedSessionBlob) as EncryptedSession
      });
    } catch {
      await failJob(input, "SESSION_DECRYPT_FAILED", `Please reconnect ${providerName(input.provider)}.`);
      return;
    }

    const context = await browserManager.createContextForUserProvider({
      userId: input.userId,
      provider: input.provider,
      storageState: sessionState
    });

    try {
      checkJobTimeout(deadline);
      await throwIfCancelled(input.jobId);
      const authStatus = await registered.adapter.validateSession(context);
      if (authStatus !== "connected") {
        await prisma.providerConnection.update({
          where: { id: connection.id },
          data: {
            status: authStatus,
            lastValidatedAt: new Date()
          }
        });
        await markRequiresLogin(input);
        return;
      }

      if (input.persistUserMessage && input.saveHistory && input.threadId) {
        await prisma.message.create({
          data: {
            userId: input.userId,
            threadId: input.threadId,
            provider: input.provider,
            role: "user",
            content: input.prompt,
            metadataJson: JSON.stringify({ jobId: input.jobId })
          }
        });
      }

      await prisma.automationJob.update({
        where: { id: input.jobId },
        data: { status: "streaming" }
      });

      if (registered.adapter.selectSubModel && input.selectedSubModelId && input.selectedSubModelId !== "current") {
        try {
          const selection = await registered.adapter.selectSubModel(context, input.selectedSubModelId);
          if (selection.selected) {
            await publisher.publish(input.jobId, {
              type: "sub_model_selected",
              provider: input.provider,
              jobId: input.jobId,
              subModelId: selection.subModelId,
              label: selection.label
            });
          } else if (selection.warning) {
            await publisher.publish(input.jobId, {
              type: "sub_model_warning",
              provider: input.provider,
              jobId: input.jobId,
              message: selection.warning
            });
          }
        } catch (err) {
          await publisher.publish(input.jobId, {
            type: "sub_model_warning",
            provider: input.provider,
            jobId: input.jobId,
            message: `Failed to select variant ${input.selectedSubModelId}: ${err instanceof Error ? err.message : "Unknown error"}. Falling back to default.`
          });
        }
      }

      let capturedConversationUrl: string | undefined;
      for await (const event of registered.adapter.sendMessage(context, {
        userId: input.userId,
        jobId: input.jobId,
        threadId: input.threadId ?? undefined,
        prompt: input.prompt,
        saveHistory: input.saveHistory,
        conversationUrl: input.conversationUrl
      })) {
        checkJobTimeout(deadline);
        await throwIfCancelled(input.jobId);
        if (event.type === "message_delta") finalText += event.text;
        if (event.type === "message_complete") {
          finalText = event.text;
          if (event.conversationUrl) capturedConversationUrl = event.conversationUrl;
        }
        if (event.type === "requires_login") {
          await markRequiresLogin(input);
          return;
        }
        if (event.type === "manual_action_required") {
          await markManualActionRequired(input, event.message);
          return;
        }
        if (event.type === "rate_limited") {
          await markRateLimited(input, event.message);
          return;
        }
        if (event.type === "error") {
          await failJob(input, event.errorCode, event.message);
          return;
        }
        await publisher.publish(input.jobId, event);
      }

      checkJobTimeout(deadline);
      await throwIfCancelled(input.jobId);
      if (input.saveHistory && input.threadId && finalText.trim()) {
        await prisma.message.create({
          data: {
            userId: input.userId,
            threadId: input.threadId,
            provider: input.provider,
            role: "assistant",
            content: finalText,
            metadataJson: JSON.stringify({ jobId: input.jobId })
          }
        });
      }

      if (input.threadId && capturedConversationUrl) {
        await persistThreadConversationUrl(input.threadId, input.provider, capturedConversationUrl);
      }

      await prisma.providerConnection.update({
        where: { id: connection.id },
        data: { lastUsedAt: new Date(), lastValidatedAt: new Date() }
      });

      await prisma.automationJob.update({
        where: { id: input.jobId },
        data: {
          status: "completed",
          completedAt: new Date(),
          outputJson: JSON.stringify({ completed: true, responseLength: finalText.length })
        }
      });

      await publisher.complete(input.jobId, input.provider);
    } finally {
      if (await isJobCancelled(input.jobId).catch(() => false)) {
        await registered.adapter
          .stopGeneration(context)
          .catch((err) => console.warn("stopGeneration failed during cleanup", { jobId: input.jobId, err }));
      }
      await browserManager.closeContext(context);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "JOB_CANCELLED") {
      await cancelJob(input);
      return;
    }
    if (error instanceof Error && error.message === "JOB_TIMEOUT") {
      await timeoutJob(input);
      return;
    }
    const safe = toSafeProviderError(error, input.provider);
    await failJob(input, safe.errorCode, safe.message);
  }
}

async function markRequiresLogin(input: ChatJobPayload): Promise<void> {
  const message = `Please reconnect ${providerName(input.provider)}.`;
  await prisma.automationJob.update({
    where: { id: input.jobId },
    data: {
      status: "requires_login",
      completedAt: new Date(),
      errorCode: "REQUIRES_LOGIN",
      errorMessageSafe: message
    }
  });

  await publisher.publish(input.jobId, {
    type: "requires_login",
    provider: input.provider,
    jobId: input.jobId,
    message
  });
  await publisher.complete(input.jobId, input.provider);
}

async function failJob(input: ChatJobPayload, errorCode: ErrorCode, message: string): Promise<void> {
  await prisma.automationJob.update({
    where: { id: input.jobId },
    data: {
      status: "failed",
      completedAt: new Date(),
      errorCode,
      errorMessageSafe: message
    }
  }).catch((err) => console.error("Failed to persist failed job status", { jobId: input.jobId, err }));

  await publisher.publish(input.jobId, {
    type: "error",
    provider: input.provider,
    jobId: input.jobId,
    errorCode,
    message
  });
  await publisher.complete(input.jobId, input.provider);
}

async function markManualActionRequired(input: ChatJobPayload, message: string): Promise<void> {
  await prisma.automationJob.update({
    where: { id: input.jobId },
    data: {
      status: "manual_action_required",
      completedAt: new Date(),
      errorCode: "MANUAL_ACTION_REQUIRED",
      errorMessageSafe: message
    }
  }).catch((err) => console.error("Failed to persist manual_action_required job status", { jobId: input.jobId, err }));

  await publisher.publish(input.jobId, {
    type: "manual_action_required",
    provider: input.provider,
    jobId: input.jobId,
    message
  });
  await publisher.complete(input.jobId, input.provider);
}

async function markRateLimited(input: ChatJobPayload, message: string): Promise<void> {
  await prisma.automationJob.update({
    where: { id: input.jobId },
    data: {
      status: "failed",
      completedAt: new Date(),
      errorCode: "PROVIDER_RATE_LIMITED",
      errorMessageSafe: message
    }
  }).catch((err) => console.error("Failed to persist rate_limited job status", { jobId: input.jobId, err }));

  await publisher.publish(input.jobId, {
    type: "rate_limited",
    provider: input.provider,
    jobId: input.jobId,
    message
  });
  await publisher.complete(input.jobId, input.provider);
}

async function cancelJob(input: ChatJobPayload): Promise<void> {
  await prisma.automationJob.update({
    where: { id: input.jobId },
    data: {
      status: "cancelled",
      completedAt: new Date(),
      errorCode: "JOB_CANCELLED",
      errorMessageSafe: "Job was cancelled."
    }
  }).catch((err) => console.error("Failed to persist cancelled job status", { jobId: input.jobId, err }));

  await publisher.publish(input.jobId, {
    type: "cancelled",
    provider: input.provider,
    jobId: input.jobId,
    message: "Job was cancelled."
  });
  await publisher.complete(input.jobId, input.provider);
}

async function timeoutJob(input: ChatJobPayload): Promise<void> {
  const message = `${providerName(input.provider)} job timed out.`;
  await prisma.automationJob.update({
    where: { id: input.jobId },
    data: {
      status: "timeout",
      completedAt: new Date(),
      errorCode: "JOB_TIMEOUT",
      errorMessageSafe: message
    }
  }).catch((err) => console.error("Failed to persist timeout job status", { jobId: input.jobId, err }));

  await publisher.publish(input.jobId, {
    type: "timeout",
    provider: input.provider,
    jobId: input.jobId,
    errorCode: "JOB_TIMEOUT",
    message
  });
  await publisher.complete(input.jobId, input.provider);
}

function toSafeProviderError(error: unknown, provider: ProviderId): { errorCode: ErrorCode; message: string } {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const name = providerName(provider);
  if (message.includes("PROVIDER_NOT_READY")) {
    return { errorCode: "PROVIDER_NOT_READY", message: "This provider is not chat-ready yet." };
  }
  if (message.includes("PROVIDER_TIMEOUT") || message.includes("Timeout")) {
    return { errorCode: "PROVIDER_TIMEOUT", message: `${name} did not finish response in time.` };
  }
  if (message.includes("JOB_TIMEOUT")) {
    return { errorCode: "JOB_TIMEOUT", message: `${name} job timed out.` };
  }
  if (message.includes("JOB_CANCELLED")) {
    return { errorCode: "JOB_CANCELLED", message: "Job was cancelled." };
  }
  if (message.includes("PROVIDER_RATE_LIMITED")) {
    return { errorCode: "PROVIDER_RATE_LIMITED", message: `${name} reports a rate or usage limit. Please wait and retry later.` };
  }
  if (message.includes("PROVIDER_UI_CHANGED")) {
    return { errorCode: "PROVIDER_UI_CHANGED", message: `${name} UI may have changed. Please update selectors.` };
  }
  return { errorCode: "CHAT_JOB_FAILED", message: "Unexpected provider error." };
}

function providerName(provider: ProviderId): string {
  return providerRegistry.get(provider).definition.displayName;
}

function checkJobTimeout(deadline: number): void {
  if (Date.now() > deadline) {
    throw new Error("JOB_TIMEOUT");
  }
}

/**
 * Persist the provider-side conversation URL onto the thread so the next turn
 * resumes the same conversation. Stored as a safe { provider: url } JSON map.
 */
async function persistThreadConversationUrl(threadId: string, provider: ProviderId, conversationUrl: string): Promise<void> {
  try {
    const thread = await prisma.chatThread.findUnique({
      where: { id: threadId },
      select: { providerConversationsJson: true }
    });
    if (!thread) return;
    let map: Record<string, string> = {};
    if (thread.providerConversationsJson) {
      try {
        const parsed = JSON.parse(thread.providerConversationsJson);
        if (parsed && typeof parsed === "object") map = parsed as Record<string, string>;
      } catch {
        map = {};
      }
    }
    if (map[provider] === conversationUrl) return;
    map[provider] = conversationUrl;
    await prisma.chatThread.update({
      where: { id: threadId },
      data: { providerConversationsJson: JSON.stringify(map) }
    });
  } catch (err) {
    console.warn("Failed to persist thread conversation URL", { threadId, provider });
  }
}

export async function shutdownChatJobProcessor(): Promise<void> {
  await browserManager.cleanup();
  await prisma.$disconnect();
}
