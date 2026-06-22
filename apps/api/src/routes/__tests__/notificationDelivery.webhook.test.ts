import { describe, it, expect, vi, beforeEach } from "vitest";
import fastify from "fastify";
import { notificationDeliveryRoutes } from "../../routes/notificationDelivery.js";
import * as prefService from "../../services/notificationDeliveryPreferenceService.js";
import * as delivService from "../../services/notificationDeliveryService.js";

vi.mock("../../services/notificationDeliveryPreferenceService.js", () => ({
  getNotificationDeliveryPreferences: vi.fn(),
  updateNotificationDeliveryPreference: vi.fn(),
  updateWebhookConfig: vi.fn(),
  rotateWebhookSigningSecret: vi.fn()
}));

vi.mock("../../services/notificationDeliveryService.js", () => ({
  deliverNotificationEvent: vi.fn(),
  listNotificationDeliveryAttempts: vi.fn()
}));

vi.mock("../../services/notificationWebhookRetryQueue.js", () => ({
  enqueueWebhookDeliveryRetry: vi.fn()
}));

// Mock auth middleware
vi.mock("../../middleware/auth.js", () => ({
  attachLocalUser: async (req: any) => {
    req.user = { id: "user_1", workspaceId: "test-ws" };
  }
}));

vi.mock("../../auth/workspaceContext.js", () => ({
  getWorkspaceContextForRequest: vi.fn(async (request: any) => {
    if (!request.user) return null;
    request.workspaceContext = {
      userId: request.user.id,
      workspaceId: "test-ws",
      membershipId: "test-membership-id",
      role: "owner",
      permissions: ["settings.read", "settings.write"]
    };
    return request.workspaceContext;
  }),
  requireWorkspaceContext: vi.fn(async (request: any, reply: any) => {
    if (!request.user) {
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }
    request.workspaceContext = {
      userId: request.user.id,
      workspaceId: "test-ws",
      membershipId: "test-membership-id",
      role: "owner",
      permissions: ["settings.read", "settings.write"]
    };
    return request.workspaceContext;
  })
}));

describe("notificationDelivery routes - Webhook", () => {
  let app: any;

  beforeEach(async () => {
    app = fastify();
    
    // Add dummy decorator so tests pass without actual middleware throwing
    app.decorateRequest("user", null);

    await app.register(notificationDeliveryRoutes);
    vi.clearAllMocks();
  });

  it("GET /settings/notification-delivery/webhook returns config", async () => {
    vi.mocked(prefService.getNotificationDeliveryPreferences).mockResolvedValue([
      { channel: "webhook", enabled: true, configured: true, label: "Webhook", description: "" } as any
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/settings/notification-delivery/webhook"
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.channel).toBe("webhook");
  });

  it("PUT /settings/notification-delivery/webhook updates config", async () => {
    vi.mocked(prefService.updateWebhookConfig).mockResolvedValue({
      preference: { channel: "webhook", enabled: true } as any,
      newSecret: "new_secret_123"
    });

    const res = await app.inject({
      method: "PUT",
      url: "/settings/notification-delivery/webhook",
      payload: { enabled: true, url: "https://example.com" }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.newSecret).toBe("new_secret_123");
    expect(prefService.updateWebhookConfig).toHaveBeenCalledWith("user_1", expect.any(String), { enabled: true, url: "https://example.com" });
  });

  it("POST /settings/notification-delivery/webhook/rotate-secret rotates secret", async () => {
    vi.mocked(prefService.rotateWebhookSigningSecret).mockResolvedValue({
      preference: { channel: "webhook" } as any,
      signingSecret: "rotated_secret_abc"
    });

    const res = await app.inject({
      method: "POST",
      url: "/settings/notification-delivery/webhook/rotate-secret"
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.signingSecret).toBe("rotated_secret_abc");
  });

  it("POST /settings/notification-delivery/webhook/test triggers delivery", async () => {
    vi.mocked(delivService.deliverNotificationEvent).mockResolvedValue([
      { channel: "webhook", status: "delivered" } as any
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/settings/notification-delivery/webhook/test"
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.attempts[0].status).toBe("delivered");
    expect(delivService.deliverNotificationEvent).toHaveBeenCalledWith("user_1", expect.objectContaining({
      kind: "test_webhook"
    }));
  });
});
