import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { apiUsageRoutes } from "../apiUsage.js";
import { getProviderLimitAnalytics } from "../../services/apiUsageService.js";

vi.mock("../../middleware/auth.js", () => ({
  attachLocalUser: async (request: any) => {
    request.user = { id: "test-user-id", email: "test@example.com" };
  }
}));

vi.mock("../../auth/workspaceContext.js", () => ({
  getWorkspaceContextForRequest: vi.fn(async (request: any) => {
    if (!request.user) return null;
    return {
      userId: request.user.id,
      workspaceId: request.user.workspaceId || "test-workspace-id",
      membershipId: "test-membership-id",
      role: request.user.role || "owner",
      permissions: ["settings.read", "settings.write"]
    };
  }),
  requireWorkspaceContext: vi.fn(async (request: any, reply: any) => {
    if (!request.user) {
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }
    return {
      userId: request.user.id,
      workspaceId: request.user.workspaceId || "test-workspace-id",
      membershipId: "test-membership-id",
      role: request.user.role || "owner",
      permissions: ["settings.read", "settings.write"]
    };
  })
}));

vi.mock("../../services/apiUsageService.js", () => ({
  getUsageSummary: vi.fn().mockResolvedValue({ totals: {}, byModel: [], byProvider: [] }),
  listUsageLogs: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 }),
  getProviderLimitAnalytics: vi.fn()
}));

const buildApp = () => {
  const app = Fastify();
  app.decorateRequest("user", null);
  app.register(apiUsageRoutes);
  return app;
};

const analyticsFixture = {
  range: "24h" as const,
  from: "2026-06-20T00:00:00.000Z",
  to: "2026-06-21T00:00:00.000Z",
  totalHits: 1,
  byProvider: [
    { provider: "chatgpt" as const, hits: 1 },
    { provider: "claude" as const, hits: 0 },
    { provider: "gemini" as const, hits: 0 }
  ],
  byModel: [{ provider: "chatgpt" as const, modelId: "chatgpt-web", hits: 1 }],
  byApiKey: [{ apiKeyId: "key_safe", name: "OpenWebUI", keyPrefix: "uai_live_safe", hits: 1 }],
  bySource: [{ source: "openai_compat" as const, hits: 1 }],
  recentEvents: [
    {
      createdAt: "2026-06-21T00:00:00.000Z",
      provider: "chatgpt" as const,
      modelId: "chatgpt-web",
      apiKeyName: "OpenWebUI",
      errorCode: "provider_rate_limit_exceeded" as const
    }
  ]
};

describe("api usage provider-limit routes", () => {
  it("uses 24h as the default range", async () => {
    vi.mocked(getProviderLimitAnalytics).mockResolvedValueOnce(analyticsFixture);

    const response = await buildApp().inject({
      method: "GET",
      url: "/settings/api-usage/provider-limits"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ summary: { totalHits: 1 } });
    expect(getProviderLimitAnalytics).toHaveBeenCalledWith("test-user-id", { range: "24h" });
  });

  it("accepts 7d range", async () => {
    vi.mocked(getProviderLimitAnalytics).mockResolvedValueOnce({ ...analyticsFixture, range: "7d" });

    const response = await buildApp().inject({
      method: "GET",
      url: "/settings/api-usage/provider-limits?range=7d"
    });

    expect(response.statusCode).toBe(200);
    expect(getProviderLimitAnalytics).toHaveBeenCalledWith("test-user-id", { range: "7d" });
  });

  it("rejects invalid ranges", async () => {
    const response = await buildApp().inject({
      method: "GET",
      url: "/settings/api-usage/provider-limits?range=30d"
    });

    expect(response.statusCode).toBe(400);
  });

  it("does not expose forbidden fields", async () => {
    vi.mocked(getProviderLimitAnalytics).mockResolvedValueOnce(analyticsFixture);

    const response = await buildApp().inject({
      method: "GET",
      url: "/settings/api-usage/provider-limits"
    });

    const raw = response.body;
    for (const forbidden of ["rawKey", "keyHash", "prompt", "response", "session", "token", "cookie"]) {
      expect(raw).not.toContain(forbidden);
    }
  });
});
