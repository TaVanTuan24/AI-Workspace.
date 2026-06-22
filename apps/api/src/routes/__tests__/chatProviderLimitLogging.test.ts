import Fastify from "fastify";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { chatRoutes } from "../chat.js";
import { logProviderRateLimitHit } from "../../services/apiUsageService.js";
import { checkProviderRateLimit, ProviderRateLimitExceededError } from "../../services/providerRateLimitService.js";

vi.mock("../../middleware/auth.js", () => ({
  attachLocalUser: async (request: any) => {
    request.user = { id: "test-user-id", email: "test@example.com" };
  }
}));

vi.mock("../../services/apiUsageService.js", () => ({
  logProviderRateLimitHit: vi.fn(),
  modelIdForProvider: (provider: string) => `${provider}-web`
}));

vi.mock("../../services/providerRateLimitService.js", () => {
  return {
    checkProviderRateLimit: vi.fn(),
    providerRateLimitHeaders: (check: any) => ({
      "X-Provider-RateLimit-Limit": String(check.limit),
      "X-Provider-RateLimit-Remaining": String(check.remaining),
      "X-Provider-RateLimit-Reset": check.resetAt
    }),
    ProviderRateLimitExceededError: class extends Error {
      check: any;
      constructor(check: any) {
        super("Provider rate limit exceeded.");
        this.check = check;
      }
    }
  };
});

vi.mock("../../services/chatJobService.js", () => ({
  validateRunnableProvider: vi.fn(async (_userId: string, provider: string) => ({ ok: true, provider })),
  createJob: vi.fn(),
  findOwnedJob: vi.fn(async () => ({
    id: "job-old",
    userId: "test-user-id",
    provider: "gemini",
    status: "failed",
    threadId: "thread-1",
    inputJson: JSON.stringify({ prompt: "hidden prompt", saveHistory: true })
  })),
  parseStoredPayload: vi.fn(() => ({ prompt: "hidden prompt", saveHistory: true })),
  enqueueCreatedJob: vi.fn(),
  resolveThreadId: vi.fn()
}));

vi.mock("../../services/chatQueue.js", () => ({
  enqueueChatJob: vi.fn(),
  getChatBullJobState: vi.fn(),
  removeQueuedChatJob: vi.fn()
}));

vi.mock("../../services/cancelSignal.js", () => ({
  requestJobCancel: vi.fn()
}));

vi.mock("../../services/prisma.js", () => ({
  prisma: {
    automationJob: {
      findFirst: vi.fn(),
      update: vi.fn()
    },
    message: {
      create: vi.fn()
    }
  }
}));

vi.mock("../../services/redisJobEventBus.js", () => ({
  RedisJobEventSubscriber: class {
    subscribe = vi.fn();
  }
}));

vi.mock("../../services/redisJobEventPublisher.js", () => ({
  publishDone: vi.fn(),
  publishJobEvent: vi.fn()
}));

vi.mock("../../services/modelPreferenceService.js", () => ({
  getModelPreferences: vi.fn()
}));

const buildApp = () => {
  const app = Fastify();
  app.decorateRequest("user", null);
  app.register(chatRoutes);
  return app;
};

function providerLimitError(provider: "chatgpt" | "grok" | "gemini", limit: number) {
  return new ProviderRateLimitExceededError({
    allowed: false,
    provider,
    limit,
    current: limit + 1,
    remaining: 0,
    resetAt: "2026-06-21T00:01:00.000Z",
    source: "env"
  });
}

describe("internal chat provider-limit usage logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs /chat provider-limit hits as internal_chat", async () => {
    vi.mocked(checkProviderRateLimit).mockRejectedValueOnce(providerLimitError("chatgpt", 20));

    const response = await buildApp().inject({
      method: "POST",
      url: "/chat",
      payload: {
        provider: "chatgpt",
        prompt: "do not log me",
        saveHistory: false
      }
    });

    expect(response.statusCode).toBe(429);
    expect(logProviderRateLimitHit).toHaveBeenCalledWith({
      userId: "test-user-id",
      provider: "chatgpt",
      modelId: "chatgpt-web",
      source: "internal_chat",
      limitPerMinute: 20
    });
    for (const forbidden of ["do not log me", "rawKey", "keyHash", "session", "cookie", "token", "storageState", "encryptedSession", "html", "screenshot"]) {
      expect(response.body).not.toContain(forbidden);
    }
  });

  it("logs /chat/multi provider-limit hits as internal_multi_chat", async () => {
    vi.mocked(checkProviderRateLimit)
      .mockRejectedValueOnce(providerLimitError("chatgpt", 20))
      .mockRejectedValueOnce(providerLimitError("grok", 10));

    const response = await buildApp().inject({
      method: "POST",
      url: "/chat/multi",
      payload: {
        providers: ["chatgpt", "grok"],
        prompt: "do not log me",
        saveHistory: false
      }
    });

    expect(response.statusCode).toBe(409);
    expect(logProviderRateLimitHit).toHaveBeenCalledWith(expect.objectContaining({
      provider: "chatgpt",
      source: "internal_multi_chat",
      limitPerMinute: 20
    }));
    expect(logProviderRateLimitHit).toHaveBeenCalledWith(expect.objectContaining({
      provider: "grok",
      source: "internal_multi_chat",
      limitPerMinute: 10
    }));
    expect(response.body).not.toContain("do not log me");
  });

  it("logs retry provider-limit hits as internal_retry", async () => {
    vi.mocked(checkProviderRateLimit).mockRejectedValueOnce(providerLimitError("gemini", 30));

    const response = await buildApp().inject({
      method: "POST",
      url: "/chat/job-old/retry"
    });

    expect(response.statusCode).toBe(429);
    expect(logProviderRateLimitHit).toHaveBeenCalledWith({
      userId: "test-user-id",
      provider: "gemini",
      modelId: "gemini-web",
      source: "internal_retry",
      limitPerMinute: 30
    });
    expect(response.body).not.toContain("hidden prompt");
  });
});
