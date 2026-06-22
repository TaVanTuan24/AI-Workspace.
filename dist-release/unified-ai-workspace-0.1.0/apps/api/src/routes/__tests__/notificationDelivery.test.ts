import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { notificationDeliveryRoutes } from "../notificationDelivery.js";
import { getNotificationDeliveryPreferences, updateNotificationDeliveryPreference } from "../../services/notificationDeliveryPreferenceService.js";
import { listNotificationDeliveryAttempts } from "../../services/notificationDeliveryService.js";

vi.mock("../../services/notificationDeliveryPreferenceService.js", () => ({
  getNotificationDeliveryPreferences: vi.fn(),
  updateNotificationDeliveryPreference: vi.fn()
}));

vi.mock("../../services/notificationDeliveryService.js", () => ({
  listNotificationDeliveryAttempts: vi.fn()
}));

const buildApp = () => {
  const app = Fastify();
  app.decorateRequest("user", null);
  app.addHook("preHandler", async (request) => {
    request.user = { id: "test-user-id", email: "test@example.com" };
  });
  app.register(notificationDeliveryRoutes);
  return app;
};

describe("notificationDelivery routes", () => {
  it("GET /settings/notification-delivery/preferences > returns preferences", async () => {
    vi.mocked(getNotificationDeliveryPreferences).mockResolvedValueOnce([
      { channel: "in_app", enabled: true, configured: true, label: "In-app", description: "..." }
    ] as any);

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/settings/notification-delivery/preferences"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      preferences: [
        { channel: "in_app", enabled: true, configured: true, label: "In-app", description: "..." }
      ]
    });
    expect(getNotificationDeliveryPreferences).toHaveBeenCalledWith("local-user");
  });

  it("PATCH /settings/notification-delivery/preferences/:channel > updates preference", async () => {
    vi.mocked(updateNotificationDeliveryPreference).mockResolvedValueOnce({
      channel: "email_noop", enabled: true, configured: false, label: "Email", description: "..."
    } as any);

    const app = buildApp();
    const response = await app.inject({
      method: "PATCH",
      url: "/settings/notification-delivery/preferences/email_noop",
      payload: { enabled: true }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      channel: "email_noop", enabled: true, configured: false, label: "Email", description: "..."
    });
    expect(updateNotificationDeliveryPreference).toHaveBeenCalledWith("local-user", "email_noop", { enabled: true });
  });

  it("GET /settings/notification-delivery/attempts > returns attempts", async () => {
    vi.mocked(listNotificationDeliveryAttempts).mockResolvedValueOnce([
      { id: "att-1", channel: "in_app", status: "delivered" }
    ] as any);

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/settings/notification-delivery/attempts?limit=10"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      attempts: [
        { id: "att-1", channel: "in_app", status: "delivered" }
      ]
    });
    expect(listNotificationDeliveryAttempts).toHaveBeenCalledWith({
      userId: "local-user",
      limit: 10,
      notificationEventId: undefined
    });
  });
});
