import type { FastifyInstance } from "fastify";
import { getAppVersionInfo } from "@uaiw/shared/version.js";
import { env } from "../config/env.js";
import { getReadinessChecks, isReady } from "../services/readinessService.js";

const versionInfo = getAppVersionInfo();
const service = {
  name: "unified-ai-workspace-api",
  version: versionInfo.version
};

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    ok: true,
    service,
    uptimeSeconds: Math.round(process.uptime())
  }));

  app.get("/ready", async (_request, reply) => {
    const checks = await getReadinessChecks();
    const ready = isReady(checks);
    return reply.code(ready ? 200 : 503).send({
      ok: ready,
      service,
      checks
    });
  });

  app.get("/version", async () => versionInfo);

  app.get("/health/details", async (_request, reply) => {
    const checks = await getReadinessChecks();
    const ready = isReady(checks);
    return reply.code(ready ? 200 : 503).send({
      ok: ready,
      service,
      version: versionInfo.version,
      commitSha: versionInfo.commitSha,
      buildTime: versionInfo.buildTime,
      buildSource: versionInfo.buildSource,
      uptimeSeconds: Math.round(process.uptime()),
      nodeEnv: env.NODE_ENV,
      features: {
        dbApiKeys: env.ENABLE_DB_API_KEYS,
        localSingleUserMode: env.LOCAL_SINGLE_USER_MODE,
        providerHealthScheduler: env.PROVIDER_HEALTH_SCHEDULER_ENABLED
      },
      checks
    });
  });
}
