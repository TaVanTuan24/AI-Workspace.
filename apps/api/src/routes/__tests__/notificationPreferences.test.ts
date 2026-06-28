import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { notificationPreferenceRoutes } from "../notificationPreferences.js";
import {
  getNotificationPreferences,
  updateNotificationPreferences
} from "../../services/notificationPreferenceService.js";

vi.mock("../../middleware/auth.js", () => ({
  attachLocalUser: async (request: any) => {
    request.user = { id: "test-user-id", email: "test@example.com", role: "owner" };
  }
}));

vi.mock("../../services/notificationPreferenceService.js", () => ({
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn()
}));

const defaultPreferences = {
  notifyProviderSessionIssues: true,
  notifyNoUsableModels: true,
  notifyProviderLimitSpikes: true,
  providerLimitSpikeThreshold24h: 10,
  notifyWorkspaceQuotaWarnings: true,
  notifyWorkspaceQuotaExceeded: true,
  workspaceQuotaWarningThresholdPercent: 90
};

const buildApp = () => {
  const app = Fastify();
  app.decorateRequest("user", null);
  app.register(notificationPreferenceRoutes);
  return app;
};

describe("notification preference routes", () => {
  it("returns defaults", async () => {
    vi.mocked(getNotificationPreferences).mockResolvedValueOnce(defaultPreferences);

    const response = await buildApp().inject({
      method: "GET",
      url: "/settings/notification-preferences"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ preferences: defaultPreferences });
    expect(getNotificationPreferences).toHaveBeenCalledWith("test-user-id");
  });

  it("updates threshold", async () => {
    vi.mocked(updateNotificationPreferences).mockResolvedValueOnce({
      ...defaultPreferences,
      providerLimitSpikeThreshold24h: 20
    });

    const response = await buildApp().inject({
      method: "PATCH",
      url: "/settings/notification-preferences",
      payload: { providerLimitSpikeThreshold24h: 20 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ preferences: { providerLimitSpikeThreshold24h: 20 } });
    expect(updateNotificationPreferences).toHaveBeenCalledWith("test-user-id", {
      providerLimitSpikeThreshold24h: 20
    });
  });

  it("rejects invalid threshold", async () => {
    const response = await buildApp().inject({
      method: "PATCH",
      url: "/settings/notification-preferences",
      payload: { providerLimitSpikeThreshold24h: 0 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errorCode: "INVALID_NOTIFICATION_PREFERENCES" });
  });
});
