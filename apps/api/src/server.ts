import Fastify from "fastify";
import cors from "@fastify/cors";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { providerRoutes } from "./routes/providers.js";
import { openaiCompatRoutes } from "./routes/openaiCompat.js";
import { apiKeyRoutes } from "./routes/apiKeys.js";
import { env } from "./config/env.js";
import { pinoRedactPaths } from "./middleware/redaction.js";
import { apiUsageRoutes } from "./routes/apiUsage.js";
import { providerHealthRoutes } from "./routes/providerHealth.js";
import { providerHealthIncidentsRoutes } from "./routes/providerHealthIncidents.js";
import { providerRateLimitRoutes } from "./routes/providerRateLimits.js";
import { modelPreferenceRoutes } from "./routes/modelPreferences.js";
import { conversationsRoutes } from "./routes/conversations.js";
import { settingsOverviewRoutes } from "./routes/settingsOverview.js";
import { workspaceNotificationRoutes } from "./routes/workspaceNotifications.js";
import { notificationEventsRoutes } from "./routes/notificationEvents.js";
import { notificationPreferenceRoutes } from "./routes/notificationPreferences.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { providerLiveSubModelsRoutes } from "./routes/providerLiveSubModels.js";
import { providerHealthScheduler } from "./services/providerHealthScheduler.js";
import { retentionCleanupScheduler } from "./services/retentionCleanupScheduler.js";
import { storageRoutes } from "./routes/storage.js";
import { healthRoutes } from "./routes/health.js";
import { prisma } from "./services/prisma.js";
import { closeChatQueue } from "./services/chatQueue.js";
import { closeCancelSignal } from "./services/cancelSignal.js";
import { closeJobEventPublisher } from "./services/redisJobEventPublisher.js";

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    redact: {
      paths: pinoRedactPaths(),
      censor: "[REDACTED]"
    }
  }
});

await app.register(cors, {
  origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
  credentials: true
});

await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(providerRoutes);
await app.register(chatRoutes);
await app.register(openaiCompatRoutes);
await app.register(apiKeyRoutes);
await app.register(apiUsageRoutes);
await app.register(providerHealthRoutes);
await app.register(providerHealthIncidentsRoutes);
await app.register(providerRateLimitRoutes);
await app.register(modelPreferenceRoutes);
await app.register(settingsOverviewRoutes);
await app.register(workspaceNotificationRoutes);
await app.register(notificationEventsRoutes);
await app.register(notificationPreferenceRoutes);
await app.register(onboardingRoutes);
await app.register(conversationsRoutes);
await app.register(providerLiveSubModelsRoutes);
await app.register(storageRoutes);

app.addHook("onClose", async () => {
  await Promise.allSettled([
    providerHealthScheduler.stop(),
    retentionCleanupScheduler.stop()
  ]);
  await Promise.allSettled([
    closeChatQueue(),
    closeCancelSignal(),
    closeJobEventPublisher(),
    prisma.$disconnect()
  ]);
});

let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  app.log.info({ signal }, "API shutdown started");

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("API shutdown timed out")), env.SHUTDOWN_TIMEOUT_MS).unref();
  });

  try {
    await Promise.race([app.close(), timeout]);
    app.log.info("API shutdown complete");
    process.exitCode = 0;
  } catch (error) {
    app.log.error({ err: error }, "API shutdown failed");
    process.exitCode = 1;
  }
}

process.once("SIGTERM", (signal) => {
  void shutdown(signal);
});

process.once("SIGINT", (signal) => {
  void shutdown(signal);
});

try {
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
  providerHealthScheduler.start();
  retentionCleanupScheduler.start();
} catch (error) {
  app.log.error({ err: error }, "API startup failed");
  await app.close().catch(() => {});
  process.exitCode = 1;
}
