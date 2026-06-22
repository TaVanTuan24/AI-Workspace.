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
    const mockOverview = {
      providers: { total: 2, connected: 1, usable: 1, requiresLogin: 1 },
      models: { total: 5, enabled: 3, usable: 2, defaultModelId: "gpt-4" },
      apiKeys: { active: 2, revoked: 1 },
      usage: { requests24h: 100, failed24h: 5, rateLimited24h: 2, providerRateLimited24h: 1, requests7d: 500 },
      backups: { lastExportAt: "2024-01-01T00:00:00Z", tracked: true },
      scheduler: { providerHealthEnabled: true },
      providerHealth: { openIncidents: 0, criticalOpenIncidents: 0, lastIncidentAt: null }
    };
    vi.mocked(getSettingsOverview).mockResolvedValueOnce(mockOverview);

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/settings/overview"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      providers: { connected: 1, usable: 1 },
      apiKeys: { active: 2 },
      scheduler: { providerHealthEnabled: true },
      providerHealth: { openIncidents: 0, criticalOpenIncidents: 0 }
    });
    const raw = response.body;
    for (const forbidden of ["rawKey", "keyHash", "cookie", "token", "storageState", "encryptedSessionBlob", "prompt"]) {
      expect(raw).not.toContain(forbidden);
    }
  });
});
