import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { providerRateLimitRoutes } from "../providerRateLimits.js";
import {
  listProviderRateLimitSettings,
  updateProviderRateLimitSetting
} from "../../services/providerRateLimitService.js";

vi.mock("../../middleware/auth.js", () => ({
  attachLocalUser: async (request: any) => {
    request.user = { id: "test-user-id", email: "test@example.com", role: "owner" };
  }
}));

vi.mock("../../services/providerRateLimitService.js", () => ({
  listProviderRateLimitSettings: vi.fn(),
  updateProviderRateLimitSetting: vi.fn()
}));

const buildApp = () => {
  const app = Fastify();
  app.decorateRequest("user", null);
  app.register(providerRateLimitRoutes);
  return app;
};

describe("provider rate limit routes", () => {
  it("returns provider limits for the local user", async () => {
    vi.mocked(listProviderRateLimitSettings).mockResolvedValueOnce({
      maxRequestsPerMinute: 300,
      limits: [
        {
          provider: "chatgpt",
          requestsPerMinute: null,
          effectiveRequestsPerMinute: 20,
          source: "env",
          enabled: true
        }
      ]
    });

    const response = await buildApp().inject({
      method: "GET",
      url: "/settings/provider-rate-limits"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      maxRequestsPerMinute: 300,
      limits: [{ provider: "chatgpt", effectiveRequestsPerMinute: 20 }]
    });
    expect(listProviderRateLimitSettings).toHaveBeenCalledWith("test-user-id");
  });

  it("updates one provider limit", async () => {
    vi.mocked(updateProviderRateLimitSetting).mockResolvedValueOnce({
      provider: "gemini",
      requestsPerMinute: 12,
      effectiveRequestsPerMinute: 12,
      source: "custom",
      enabled: true
    });

    const response = await buildApp().inject({
      method: "PATCH",
      url: "/settings/provider-rate-limits/gemini",
      payload: { requestsPerMinute: 12 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      limit: { provider: "gemini", requestsPerMinute: 12, source: "custom" }
    });
    expect(updateProviderRateLimitSetting).toHaveBeenCalledWith("test-user-id", "gemini", 12);
  });

  it("rejects unknown providers", async () => {
    const response = await buildApp().inject({
      method: "PATCH",
      url: "/settings/provider-rate-limits/not-real",
      payload: { requestsPerMinute: 12 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errorCode: "INVALID_PROVIDER" });
  });
});
