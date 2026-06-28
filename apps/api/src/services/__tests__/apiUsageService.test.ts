import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createUsageStart,
  completeUsageSuccess,
  completeUsageError,
  logRateLimitHit,
  getUsageSummary,
  listUsageLogs,
  getProviderLimitAnalytics,
  logProviderRateLimitHit
} from "../apiUsageService.js";
import { prisma } from "../prisma.js";

describe("apiUsageService", () => {
  beforeEach(async () => {
    await prisma.internalApiUsageLog.deleteMany({ where: { userId: "test-user-usage" } });
    await prisma.internalApiKey.deleteMany({ where: { userId: "test-user-usage" } });
    await prisma.user.deleteMany({ where: { id: "test-user-usage" } });

    await prisma.user.create({
      data: {
        id: "test-user-usage",
        email: "test-usage@local.com"
      }
    });
  });

  afterEach(async () => {
    await prisma.internalApiUsageLog.deleteMany({ where: { userId: "test-user-usage" } });
    await prisma.internalApiKey.deleteMany({ where: { userId: "test-user-usage" } });
    await prisma.user.deleteMany({ where: { id: "test-user-usage" } });
  });

  it("should create a usage log and not store prompt text", async () => {
    const log = await createUsageStart({
      userId: "test-user-usage",
      model: "chatgpt-web",
      provider: "chatgpt",
      endpoint: "/v1/chat/completions",
      requestId: "req_123",
      stream: false,
      messageCount: 2,
      inputCharCount: 150
    });

    expect(log.status).toBe("queued");
    expect(log.model).toBe("chatgpt-web");
    expect(log.inputCharCount).toBe(150);
    // Explicitly check that there is no 'messages' or 'prompt' field on the returned schema object
    expect((log as any).messages).toBeUndefined();
    expect((log as any).prompt).toBeUndefined();
  });

  it("should complete a usage log with success", async () => {
    const log = await createUsageStart({
      userId: "test-user-usage",
      model: "gemini-web",
      provider: "gemini",
      endpoint: "/v1/chat/completions",
      requestId: "req_2",
      stream: true,
      messageCount: 1,
      inputCharCount: 10
    });

    await completeUsageSuccess(log.id, { outputCharCount: 500, durationMs: 2500 });

    const updated = await prisma.internalApiUsageLog.findUnique({ where: { id: log.id } });
    expect(updated?.status).toBe("completed");
    expect(updated?.outputCharCount).toBe(500);
    expect(updated?.durationMs).toBe(2500);
  });

  it("should log a rate limit hit safely", async () => {
    await logRateLimitHit({
      userId: "test-user-usage",
      model: "claude-web",
      provider: "claude",
      endpoint: "/v1/chat/completions",
      requestId: "req_rl"
    });

    const summary = await getUsageSummary("test-user-usage", {});
    expect(summary.totals.rateLimited).toBe(1);
  });

  it("should list usage logs and generate summary", async () => {
    const log1 = await createUsageStart({
      userId: "test-user-usage",
      model: "chatgpt-web",
      provider: "chatgpt",
      endpoint: "/v1",
      requestId: "req_3",
      stream: false,
      messageCount: 1,
      inputCharCount: 100
    });
    await completeUsageSuccess(log1.id, { outputCharCount: 200, durationMs: 1000 });

    const log2 = await createUsageStart({
      userId: "test-user-usage",
      model: "chatgpt-web",
      provider: "chatgpt",
      endpoint: "/v1",
      requestId: "req_4",
      stream: false,
      messageCount: 1,
      inputCharCount: 150
    });
    await completeUsageError(log2.id, { errorCode: "TEST_ERR", durationMs: 500 });

    const logs = await listUsageLogs("test-user-usage", {});
    expect(logs.total).toBe(2);
    expect(logs.items).toHaveLength(2);

    const summary = await getUsageSummary("test-user-usage", {});
    expect(summary.totals.requests).toBe(2);
    expect(summary.totals.completed).toBe(1);
    expect(summary.totals.failed).toBe(1);
    expect(summary.totals.inputChars).toBe(250);
    expect(summary.totals.outputChars).toBe(200);

    const modelStats = summary.byModel.find(m => m.model === "chatgpt-web");
    expect(modelStats?.requests).toBe(2);
    expect(modelStats?.completed).toBe(1);
  });

  it("returns zero provider-limit hits by provider when there are no hits", async () => {
    const analytics = await getProviderLimitAnalytics("test-user-usage", { range: "24h" });
    expect(analytics.totalHits).toBe(0);
    expect(analytics.byProvider).toEqual([
      { provider: "chatgpt", hits: 0 },
      { provider: "claude", hits: 0 },
      { provider: "gemini", hits: 0 }
    ]);
  });

  it("aggregates provider-limit hits by provider, model, and safe API key display", async () => {
    const key = await prisma.internalApiKey.create({
      data: {
        userId: "test-user-usage",
        name: "OpenWebUI",
        keyPrefix: "uai_live_safe",
        keyLast4: "1234",
        keyHash: "hashed-secret",
        status: "active"
      }
    });

    await createProviderLimitLog({ provider: "chatgpt", model: "chatgpt-web", apiKeyId: key.id, apiKeyPrefix: key.keyPrefix });
    await createProviderLimitLog({ provider: "chatgpt", model: "chatgpt-web", apiKeyId: key.id, apiKeyPrefix: key.keyPrefix });
    await createProviderLimitLog({ provider: "claude", model: "claude-web" });

    const analytics = await getProviderLimitAnalytics("test-user-usage", { range: "24h" });

    expect(analytics.totalHits).toBe(3);
    expect(analytics.byProvider).toContainEqual({ provider: "chatgpt", hits: 2 });
    expect(analytics.byProvider).toContainEqual({ provider: "claude", hits: 1 });
    expect(analytics.byModel).toContainEqual({ provider: "chatgpt", modelId: "chatgpt-web", hits: 2 });
    expect(analytics.byApiKey).toContainEqual({
      apiKeyId: key.id,
      name: "OpenWebUI",
      keyPrefix: "uai_live_safe",
      hits: 2
    });
    const raw = JSON.stringify(analytics);
    for (const forbidden of ["hashed-secret", "rawKey", "prompt", "response", "cookie", "token", "session"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("excludes per-key rate-limit hits and non-rate-limited failures", async () => {
    await createProviderLimitLog({ provider: "gemini", model: "gemini-web" });
    await prisma.internalApiUsageLog.create({
      data: {
        userId: "test-user-usage",
        model: "gemini-web",
        provider: "gemini",
        endpoint: "/v1/chat/completions",
        requestId: "req_key_limit",
        status: "rate_limited",
        errorCode: "rate_limit_exceeded",
        errorType: "rate_limit_error",
        stream: false,
        messageCount: 0,
        inputCharCount: 0
      }
    });
    await prisma.internalApiUsageLog.create({
      data: {
        userId: "test-user-usage",
        model: "gemini-web",
        provider: "gemini",
        endpoint: "/v1/chat/completions",
        requestId: "req_failed",
        status: "failed",
        errorCode: "PROVIDER_TIMEOUT",
        stream: false,
        messageCount: 1,
        inputCharCount: 10
      }
    });

    const analytics = await getProviderLimitAnalytics("test-user-usage", { range: "24h" });
    expect(analytics.totalHits).toBe(1);
    expect(analytics.byProvider).toContainEqual({ provider: "gemini", hits: 1 });
  });

  it("caps recent provider-limit events at 20", async () => {
    for (let i = 0; i < 25; i += 1) {
      await createProviderLimitLog({ provider: "chatgpt", model: "chatgpt-web", requestId: `req_recent_${i}` });
    }

    const analytics = await getProviderLimitAnalytics("test-user-usage", { range: "24h" });
    expect(analytics.totalHits).toBe(25);
    expect(analytics.recentEvents).toHaveLength(20);
  });

  it("logs internal provider-limit hits with safe metadata only", async () => {
    await logProviderRateLimitHit({
      userId: "test-user-usage",
      provider: "chatgpt",
      modelId: "chatgpt-web",
      source: "internal_chat",
      limitPerMinute: 20
    });

    const record = await prisma.internalApiUsageLog.findFirst({
      where: { userId: "test-user-usage", errorCode: "provider_rate_limit_exceeded" }
    });
    expect(record).toMatchObject({
      apiKeyId: null,
      apiKeyPrefix: null,
      model: "chatgpt-web",
      provider: "chatgpt",
      source: "internal_chat",
      status: "rate_limited",
      errorCode: "provider_rate_limit_exceeded",
      limitType: "provider",
      limitPerMinute: 20,
      messageCount: 0,
      inputCharCount: 0
    });
    const raw = JSON.stringify(record);
    for (const forbidden of ["prompt", "messages", "response", "rawKey", "keyHash", "session", "cookie", "token", "storageState", "encryptedSession", "html", "screenshot"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("logs OpenAI provider-limit hits with safe API key display", async () => {
    const key = await prisma.internalApiKey.create({
      data: {
        userId: "test-user-usage",
        name: "OpenWebUI",
        keyPrefix: "uai_live_safe",
        keyLast4: "1234",
        keyHash: "hashed-secret",
        status: "active"
      }
    });
    await logProviderRateLimitHit({
      userId: "test-user-usage",
      provider: "claude",
      modelId: "claude-web",
      source: "openai_compat",
      limitPerMinute: 10,
      apiKeyId: key.id,
      apiKeyName: "OpenWebUI",
      apiKeyPrefix: "uai_live_safe"
    });

    const record = await prisma.internalApiUsageLog.findFirst({
      where: { userId: "test-user-usage", provider: "claude" }
    });
    expect(record).toMatchObject({
      apiKeyId: key.id,
      apiKeyName: "OpenWebUI",
      apiKeyPrefix: "uai_live_safe",
      source: "openai_compat",
      limitType: "provider",
      limitPerMinute: 10
    });
  });

  it("updates an existing OpenAI usage start when provider limit is hit", async () => {
    const start = await createUsageStart({
      userId: "test-user-usage",
      model: "gemini-web",
      provider: "gemini",
      endpoint: "/v1/chat/completions",
      requestId: "req_existing",
      stream: false,
      messageCount: 1,
      inputCharCount: 12
    });

    await logProviderRateLimitHit({
      userId: "test-user-usage",
      provider: "gemini",
      modelId: "gemini-web",
      source: "openai_compat",
      limitPerMinute: 30,
      usageLogId: start.id
    });

    const updated = await prisma.internalApiUsageLog.findUnique({ where: { id: start.id } });
    expect(updated).toMatchObject({
      status: "rate_limited",
      errorCode: "provider_rate_limit_exceeded",
      source: "openai_compat",
      limitType: "provider",
      limitPerMinute: 30
    });
  });

  it("aggregates provider-limit hits by source", async () => {
    await logProviderRateLimitHit({
      userId: "test-user-usage",
      provider: "chatgpt",
      source: "internal_chat",
      limitPerMinute: 20
    });
    await logProviderRateLimitHit({
      userId: "test-user-usage",
      provider: "chatgpt",
      source: "internal_multi_chat",
      limitPerMinute: 20
    });
    await logProviderRateLimitHit({
      userId: "test-user-usage",
      provider: "chatgpt",
      source: "openai_compat",
      limitPerMinute: 20
    });

    const analytics = await getProviderLimitAnalytics("test-user-usage", { range: "24h" });
    expect(analytics.bySource).toContainEqual({ source: "internal_chat", hits: 1 });
    expect(analytics.bySource).toContainEqual({ source: "internal_multi_chat", hits: 1 });
    expect(analytics.bySource).toContainEqual({ source: "openai_compat", hits: 1 });
    expect(analytics.bySource).toContainEqual({ source: "internal_retry", hits: 0 });
  });
});

async function createProviderLimitLog(input: {
  provider: "chatgpt" | "claude" | "gemini";
  model: string;
  requestId?: string;
  apiKeyId?: string;
  apiKeyPrefix?: string;
}) {
  return prisma.internalApiUsageLog.create({
    data: {
      userId: "test-user-usage",
      apiKeyId: input.apiKeyId,
      apiKeyPrefix: input.apiKeyPrefix,
      model: input.model,
      provider: input.provider,
      endpoint: "/v1/chat/completions",
      requestId: input.requestId ?? `req_provider_limit_${Math.random()}`,
      status: "rate_limited",
      errorCode: "provider_rate_limit_exceeded",
      errorType: "rate_limit_error",
      stream: false,
      messageCount: 1,
      inputCharCount: 42
    }
  });
}
