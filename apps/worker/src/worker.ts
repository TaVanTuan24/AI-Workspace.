import { access } from "node:fs/promises";
import { QueueEvents, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import type { ChatJobPayload, ProviderId } from "@uaiw/shared/types/provider.js";
import { env } from "./config/env.js";
import { workerRedis } from "./services/chatQueue.js";
import { chatJobProcessor, shutdownChatJobProcessor } from "./processors/chatJobProcessor.js";
import { notificationWebhookRetryProcessor, shutdownNotificationWebhookRetryProcessor } from "./processors/notificationWebhookRetryProcessor.js";
import { RedisJobEventPublisher } from "./services/redisJobEventPublisher.js";

const prisma = new PrismaClient();
const publisher = new RedisJobEventPublisher(workerRedis);

let worker: Worker<ChatJobPayload> | undefined;
let queueEvents: QueueEvents | undefined;
let webhookRetryWorker: Worker<any> | undefined;
let webhookRetryQueueEvents: QueueEvents | undefined;
let isShuttingDown = false;

async function main(): Promise<void> {
  await runStartupChecks();

  worker = new Worker("chat-jobs", chatJobProcessor, {
    connection: workerRedis,
    concurrency: env.CHAT_WORKER_CONCURRENCY,
    lockDuration: 1000 * 60 * 5
  });

  queueEvents = new QueueEvents("chat-jobs", {
    connection: workerRedis
  });

  webhookRetryWorker = new Worker("notification-webhook-retry", notificationWebhookRetryProcessor, {
    connection: workerRedis,
    concurrency: 2
  });

  webhookRetryQueueEvents = new QueueEvents("notification-webhook-retry", {
    connection: workerRedis
  });

  wireWorkerEvents(worker, queueEvents);
  wireWebhookRetryEvents(webhookRetryWorker, webhookRetryQueueEvents);

  await Promise.all([
    worker.waitUntilReady(),
    queueEvents.waitUntilReady(),
    webhookRetryWorker.waitUntilReady(),
    webhookRetryQueueEvents.waitUntilReady()
  ]);

  console.info("Unified AI Workspace worker started", {
    redisUrl: redactRedisUrl(env.REDIS_URL),
    concurrency: env.CHAT_WORKER_CONCURRENCY
  });
}

async function runStartupChecks(): Promise<void> {
  await prisma.$queryRawUnsafe("SELECT 1");
  await workerRedis.ping();

  const chromiumPath = chromium.executablePath();
  await access(chromiumPath);
}

function wireWorkerEvents(chatWorker: Worker<ChatJobPayload>, events: QueueEvents): void {
  chatWorker.on("failed", (job, err) => {
    // Do not log job payload because prompt text can be sensitive.
    console.error("chat job failed", {
      jobId: job?.id,
      message: err.message
    });
    if (job?.data) {
      void markWorkerFailure(job.data, "CHAT_JOB_FAILED", "Worker failed while processing the job.");
    }
  });

  chatWorker.on("completed", (job) => {
    console.info("chat job completed", { jobId: job.id });
  });

  events.on("stalled", ({ jobId }) => {
    console.error("chat job stalled", { jobId });
    void markStalledJob(jobId);
  });
}

function wireWebhookRetryEvents(retryWorker: Worker<any>, events: QueueEvents): void {
  retryWorker.on("failed", (job, err) => {
    console.error("webhook retry job failed internally", {
      jobId: job?.id,
      message: err.message
    });
  });

  retryWorker.on("completed", (job) => {
    console.info("webhook retry job completed", { jobId: job.id });
  });

  events.on("stalled", ({ jobId }) => {
    console.error("webhook retry job stalled", { jobId });
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.info("Unified AI Workspace worker shutdown started", { signal });

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Worker shutdown timed out")), env.SHUTDOWN_TIMEOUT_MS).unref();
  });

  try {
    await Promise.race([
      Promise.allSettled([
        worker?.close(),
        queueEvents?.close(),
        webhookRetryWorker?.close(),
        webhookRetryQueueEvents?.close(),
        shutdownChatJobProcessor(),
        shutdownNotificationWebhookRetryProcessor(),
        prisma.$disconnect(),
        workerRedis.quit().catch(() => {
          workerRedis.disconnect();
        })
      ]),
      timeout
    ]);
    console.info("Unified AI Workspace worker shutdown complete");
    process.exitCode = 0;
  } catch (error) {
    console.error("Unified AI Workspace worker shutdown failed", {
      message: error instanceof Error ? error.message : "Unknown error"
    });
    process.exitCode = 1;
  }
}

process.once("SIGTERM", (signal) => {
  void shutdown(signal);
});

process.once("SIGINT", (signal) => {
  void shutdown(signal);
});

main().catch(async (error) => {
  console.error("Unified AI Workspace worker startup failed", {
    message: error instanceof Error ? error.message : "Unknown error"
  });
  await shutdown("SIGTERM");
  process.exitCode = 1;
});

async function markStalledJob(jobId: string): Promise<void> {
  const dbJob = await prisma.automationJob.findUnique({ where: { id: jobId } }).catch(() => null);
  if (!dbJob || dbJob.status === "completed" || dbJob.status === "cancelled") return;
  const provider = isKnownProvider(dbJob.provider) ? dbJob.provider : "gemini";
  await markWorkerFailure(
    {
      jobId,
      userId: dbJob.userId,
      provider,
      threadId: dbJob.threadId,
      prompt: "",
      saveHistory: false,
      persistUserMessage: false
    },
    "JOB_TIMEOUT",
    "Worker stalled while processing the job."
  );
}

async function markWorkerFailure(
  payload: ChatJobPayload,
  errorCode: "CHAT_JOB_FAILED" | "JOB_TIMEOUT",
  message: string
): Promise<void> {
  await prisma.automationJob.update({
    where: { id: payload.jobId },
    data: {
      status: errorCode === "JOB_TIMEOUT" ? "timeout" : "failed",
      completedAt: new Date(),
      errorCode,
      errorMessageSafe: message
    }
  }).catch(() => {});

  if (errorCode === "JOB_TIMEOUT") {
    await publisher.publish(payload.jobId, {
      type: "timeout",
      provider: payload.provider,
      jobId: payload.jobId,
      errorCode,
      message
    });
  } else {
    await publisher.publish(payload.jobId, {
      type: "error",
      provider: payload.provider,
      jobId: payload.jobId,
      errorCode,
      message
    });
  }
  await publisher.complete(payload.jobId, payload.provider);
}

function isKnownProvider(provider: string): provider is ProviderId {
  return provider === "gemini" || provider === "chatgpt" || provider === "claude";
}

function redactRedisUrl(value: string): string {
  return value.replace(/\/\/.*@/, "//[REDACTED]@");
}
