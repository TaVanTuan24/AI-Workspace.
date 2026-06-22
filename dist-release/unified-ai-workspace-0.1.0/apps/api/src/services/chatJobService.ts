import { isProviderId, type ChatJobPayload, type ErrorCode, type ProviderId } from "@uaiw/shared/types/provider.js";
import { prisma } from "./prisma.js";
import { providerRegistry } from "./providerRegistry.js";
import { enqueueChatJob } from "./chatQueue.js";
import { publishJobEvent } from "./redisJobEventPublisher.js";

export interface ProviderItemError {
  provider: string;
  errorCode: ErrorCode | "UNKNOWN_PROVIDER" | "CHAT_JOB_FAILED";
  message: string;
}

export async function validateRunnableProvider(
  userId: string,
  providerValue: string
): Promise<{ ok: true; provider: ProviderId } | { ok: false; error: ProviderItemError }> {
  if (!isProviderId(providerValue)) {
    return {
      ok: false,
      error: {
        provider: providerValue,
        errorCode: "UNKNOWN_PROVIDER",
        message: "Unknown provider."
      }
    };
  }

  const definition = providerRegistry.get(providerValue).definition;
  if (!definition.capabilities.includes("send_message") || definition.readiness !== "ready") {
    return {
      ok: false,
      error: {
        provider: providerValue,
        errorCode: "PROVIDER_NOT_READY",
        message: "This provider is not chat-ready yet."
      }
    };
  }

  const connection = await prisma.providerConnection.findUnique({
    where: { userId_provider: { userId, provider: providerValue } }
  });

  if (!connection || connection.status !== "connected" || !connection.encryptedSessionBlob) {
    return {
      ok: false,
      error: {
        provider: providerValue,
        errorCode: "REQUIRES_LOGIN",
        message: `Please reconnect ${definition.displayName}.`
      }
    };
  }

  return { ok: true, provider: providerValue };
}

export async function createJob(input: {
  userId: string;
  provider: ProviderId;
  threadId: string | null;
  prompt: string;
  saveHistory: boolean;
  retryOfJobId?: string;
  selectedSubModelId?: string;
  selectedSubModelLabel?: string;
}) {
  const dbJob = await prisma.automationJob.create({
    data: {
      userId: input.userId,
      provider: input.provider,
      threadId: input.threadId,
      status: "queued",
      inputJson: JSON.stringify({
        provider: input.provider,
        threadId: input.threadId,
        promptLength: input.prompt.length,
        prompt: input.prompt,
        saveHistory: input.saveHistory,
        retryOfJobId: input.retryOfJobId,
        selectedSubModelId: input.selectedSubModelId,
        selectedSubModelLabel: input.selectedSubModelLabel
      })
    }
  });
  return dbJob;
}

export async function findOwnedJob(jobId: string, userId: string) {
  return prisma.automationJob.findFirst({
    where: { id: jobId, userId }
  });
}

export function parseStoredPayload(inputJson: string): Pick<ChatJobPayload, "prompt" | "saveHistory"> | null {
  try {
    const parsed = JSON.parse(inputJson) as { prompt?: unknown; saveHistory?: unknown };
    if (typeof parsed.prompt !== "string") return null;
    return {
      prompt: parsed.prompt,
      saveHistory: typeof parsed.saveHistory === "boolean" ? parsed.saveHistory : true
    };
  } catch {
    return null;
  }
}

export async function enqueueCreatedJob(input: {
  jobId: string;
  userId: string;
  provider: ProviderId;
  threadId: string | null;
  prompt: string;
  saveHistory: boolean;
  persistUserMessage: boolean;
  selectedSubModelId?: string;
  selectedSubModelLabel?: string;
}): Promise<ProviderItemError | null> {
  try {
    await enqueueChatJob(input);
    await publishJobEvent(input.jobId, {
      type: "queued",
      provider: input.provider,
      jobId: input.jobId
    });
    return null;
  } catch {
    await prisma.automationJob.update({
      where: { id: input.jobId },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorCode: "CHAT_JOB_FAILED",
        errorMessageSafe: "Unable to enqueue chat job. Is Redis running?"
      }
    }).catch(() => {});

    return {
      provider: input.provider,
      errorCode: "CHAT_JOB_FAILED",
      message: "Unable to enqueue chat job. Is Redis running?"
    };
  }
}

export async function resolveThreadId(input: {
  userId: string;
  threadId?: string;
  prompt: string;
  saveHistory: boolean;
}): Promise<string | null> {
  if (input.threadId) {
    const existing = await prisma.chatThread.findFirst({
      where: { id: input.threadId, userId: input.userId }
    });
    if (existing) return existing.id;
  }

  if (!input.saveHistory) {
    return null;
  }

  const thread = await prisma.chatThread.create({
    data: {
      userId: input.userId,
      title: input.prompt.slice(0, 60)
    }
  });
  return thread.id;
}
