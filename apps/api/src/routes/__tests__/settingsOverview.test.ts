import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { settingsOverviewRoutes } from "../settingsOverview.js";
import { getSettingsOverview } from "../../services/settingsOverviewService.js";

import { createWorkspaceTestContext, buildAuthHeaders } from "../../test/workspaceTestContext.js";
import { cleanupTestUserData } from "../../test/testIsolation.js";

vi.mock("../../services/settingsOverviewService.js", () => ({
  getSettingsOverview: vi.fn()
}));

const buildApp = () => {
  const app = Fastify();
  app.register(settingsOverviewRoutes);
  return app;
};

describe("settings overview routes", () => {
  it("returns safe metadata counts", async () => {
    const ctx = await createWorkspaceTestContext("ws-settings-rt");
    const mockOverview = {
      currentUser: {
        id: ctx.userId,
        membershipId: "test-membership-id",
        role: "owner" as const,
        permissions: ["settings.read" as const]
      },
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
      url: "/settings/overview",
      headers: buildAuthHeaders(ctx)
    });

    if (response.statusCode !== 200) console.log(response.json());
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
    
    await cleanupTestUserData(ctx.userId);
  });
});
