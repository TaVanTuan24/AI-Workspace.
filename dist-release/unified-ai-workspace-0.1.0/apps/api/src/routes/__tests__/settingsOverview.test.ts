import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { settingsOverviewRoutes } from "../settingsOverview.js";
import { getSettingsOverview } from "../../services/settingsOverviewService.js";

vi.mock("../../services/settingsOverviewService.js", () => ({
  getSettingsOverview: vi.fn()
}));

const buildApp = () => {
  const app = Fastify();
  app.decorateRequest("user", null);
  app.addHook("preHandler", async (request) => {
    request.user = { id: "test-user-id", email: "test@example.com" };
  });
  app.register(settingsOverviewRoutes);
  return app;
};

describe("settings overview routes", () => {
  it("returns safe metadata counts", async () => {
    vi.mocked(getSettingsOverview).mockResolvedValueOnce({
      providers: { total: 3, connected: 2, usable: 2, requiresLogin: 1 },
      models: { total: 3, enabled: 3, usable: 2, defaultModelId: "chatgpt-web" },
      apiKeys: { active: 4, revoked: 1 },
      usage: { requests24h: 120, failed24h: 3, rateLimited24h: 1, providerRateLimited24h: 1, requests7d: 640 },
      backups: { lastExportAt: null, tracked: false },
      scheduler: { providerHealthEnabled: false }
    });

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/settings/overview"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      providers: { connected: 2, usable: 2 },
      apiKeys: { active: 4 },
      scheduler: { providerHealthEnabled: false }
    });
    const raw = response.body;
    for (const forbidden of ["rawKey", "keyHash", "cookie", "token", "storageState", "encryptedSessionBlob", "prompt"]) {
      expect(raw).not.toContain(forbidden);
    }
  });
});
