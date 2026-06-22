import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { ChatJobPayload } from "@uaiw/shared/types/provider.js";
import { env } from "../config/env.js";

export const chatQueueConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});

export const chatJobQueue = new Queue<ChatJobPayload>("chat-jobs", {
  connection: chatQueueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 100
  }
});

export async function enqueueChatJob(payload: ChatJobPayload): Promise<void> {
  await chatJobQueue.add("send-message", payload, {
    jobId: payload.jobId
  });
}

export async function getChatBullJob(jobId: string) {
  return chatJobQueue.getJob(jobId);
}

export async function getChatBullJobState(jobId: string): Promise<string | null> {
  const job = await getChatBullJob(jobId);
  return job ? job.getState() : null;
}

export async function removeQueuedChatJob(jobId: string): Promise<boolean> {
  const job = await getChatBullJob(jobId);
  if (!job) return false;
  const state = await job.getState();
  if (state === "waiting" || state === "delayed" || state === "prioritized") {
    await job.remove();
    return true;
  }
  return false;
}

export async function closeChatQueue(): Promise<void> {
  await chatJobQueue.close().catch(() => {});
  await chatQueueConnection.quit().catch(() => {
    chatQueueConnection.disconnect();
  });
}
