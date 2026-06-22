import { Job } from "bullmq";
import type { WebhookRetryJobData } from "../../../api/src/services/notificationWebhookRetryQueue.js";
import { processWebhookRetry } from "../../../api/src/services/notificationDeliveryService.js";

export async function notificationWebhookRetryProcessor(job: Job<WebhookRetryJobData>): Promise<void> {
  const { userId, notificationEventId } = job.data;
  
  // Format: webhook-retry:userId:eventId:attemptNumber:destinationId
  const parts = job.id?.split(":") ?? [];
  const attemptNumber = parseInt(parts[3] ?? "2", 10);

  if (isNaN(attemptNumber)) {
    console.warn("Invalid attempt number in webhook retry job id", { jobId: job.id });
    return;
  }

  try {
    await processWebhookRetry({
      userId,
      notificationEventId,
      attemptNumber,
      destinationId: job.data.destinationId,
      routeAttemptIndex: job.data.routeAttemptIndex
    });
  } catch (err: any) {
    console.error("Failed to process webhook retry", {
      jobId: job.id,
      error: err.message
    });
    // Rethrow to let BullMQ know the job failed, but typically processWebhookRetry catches and records errors in DB.
    // If it threw, it's a critical DB/Prisma error.
    throw err;
  }
}

export async function shutdownNotificationWebhookRetryProcessor(): Promise<void> {
  // Any cleanup needed
}
