import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

vi.mock("../../services/notificationWebhookRetryQueue.js", () => ({
  enqueueWebhookDeliveryRetry: vi.fn()
}));

import { createWorkspaceTestContext, type WorkspaceTestContext, buildAuthHeaders } from "../../test/workspaceTestContext.js";
import { cleanupTestUserData } from "../../test/testIsolation.js";

const buildApp = () => {
  const app = Fastify();
  app.register(notificationDeliveryRoutes);
  return app;
};

describe("notificationDelivery routes", () => {
  let ctx: WorkspaceTestContext;

  beforeEach(async () => {
    ctx = await createWorkspaceTestContext("route-notif-deliv");
  });

  afterEach(async () => {
    if (ctx) await cleanupTestUserData(ctx.userId);
  });

  it("GET /settings/notification-delivery/preferences > returns preferences", async () => {
    vi.mocked(getNotificationDeliveryPreferences).mockResolvedValueOnce([
      { channel: "in_app", enabled: true, configured: true, label: "In-app", description: "..." }
    ] as any);

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/settings/notification-delivery/preferences",
      headers: buildAuthHeaders(ctx)
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      preferences: [
        { channel: "in_app", enabled: true, configured: true, label: "In-app", description: "..." }
      ]
    });
    expect(getNotificationDeliveryPreferences).toHaveBeenCalledWith(ctx.userId);
  });

  it("PATCH /settings/notification-delivery/preferences/:channel > updates preference", async () => {
    vi.mocked(updateNotificationDeliveryPreference).mockResolvedValueOnce({
      channel: "email_noop", enabled: true, configured: false, label: "Email", description: "..."
    } as any);

    const app = buildApp();
    const response = await app.inject({
      method: "PATCH",
      url: "/settings/notification-delivery/preferences/email_noop",
      headers: buildAuthHeaders(ctx),
      payload: { enabled: true }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      channel: "email_noop", enabled: true, configured: false, label: "Email", description: "..."
    });
    expect(updateNotificationDeliveryPreference).toHaveBeenCalledWith(ctx.userId, ctx.workspaceId, "email_noop", { enabled: true });
  });

  it("GET /settings/notification-delivery/attempts > returns attempts", async () => {
    vi.mocked(listNotificationDeliveryAttempts).mockResolvedValueOnce([
      { id: "att-1", channel: "in_app", status: "delivered" }
    ] as any);

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/settings/notification-delivery/attempts?limit=10",
      headers: buildAuthHeaders(ctx)
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      attempts: [
        { id: "att-1", channel: "in_app", status: "delivered" }
      ]
    });
    expect(listNotificationDeliveryAttempts).toHaveBeenCalledWith({
      userId: ctx.userId,
      limit: 10,
      notificationEventId: undefined
    });
  });
});
