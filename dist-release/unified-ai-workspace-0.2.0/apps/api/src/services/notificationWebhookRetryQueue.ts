import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

export interface WebhookRetryJobData {
  userId: string;
  notificationEventId: string;
  reason?: string;
  destinationId?: string;
  routeAttemptIndex?: number;
}

export const webhookRetryQueueConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});

export const QUEUE_NAME = "notification-webhook-retry";

export const webhookRetryQueue = new Queue<WebhookRetryJobData>(QUEUE_NAME, {
  connection: webhookRetryQueueConnection,
  defaultJobOptions: {
    attempts: 1, // we handle retries manually by scheduling new jobs with incrementing attempt count
    removeOnComplete: 100,
    removeOnFail: 100
  }
});

export function getWebhookRetryQueueName(): string {
  return QUEUE_NAME;
}

export async function enqueueWebhookDeliveryRetry(input: {
  userId: string;
  notificationEventId: string;
  delayMs: number;
  attemptNumber: number;
  reason?: string;
  destinationId?: string;
  routeAttemptIndex?: number;
}): Promise<{ jobId: string }> {
  const jobId = `webhook-retry:${input.userId}:${input.notificationEventId}:${input.attemptNumber}:${input.destinationId || "legacy"}`;
  
  await webhookRetryQueue.add(
    "retry-webhook",
    {
      userId: input.userId,
      notificationEventId: input.notificationEventId,
      reason: input.reason,
      destinationId: input.destinationId,
      routeAttemptIndex: input.routeAttemptIndex
    },
    {
      jobId,
      delay: input.delayMs
    }
  );

  return { jobId };
}

export async function closeWebhookRetryQueue(): Promise<void> {
  await webhookRetryQueue.close().catch(() => {});
  await webhookRetryQueueConnection.quit().catch(() => {
    webhookRetryQueueConnection.disconnect();
  });
}
