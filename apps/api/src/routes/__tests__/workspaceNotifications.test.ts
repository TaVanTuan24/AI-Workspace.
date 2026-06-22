import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { workspaceNotificationRoutes } from "../workspaceNotifications.js";
import { getWorkspaceNotifications } from "../../services/workspaceNotificationService.js";
import { listNotificationEvents } from "../../services/notificationEventService.js";

import { createWorkspaceTestContext, buildAuthHeaders } from "../../test/workspaceTestContext.js";
import { cleanupTestUserData } from "../../test/testIsolation.js";

vi.mock("../../services/workspaceNotificationService.js", () => ({
  getWorkspaceNotifications: vi.fn()
}));

vi.mock("../../services/notificationEventService.js", () => ({
  listNotificationEvents: vi.fn()
}));

const buildApp = () => {
  const app = Fastify();
  app.register(workspaceNotificationRoutes);
  return app;
};

describe("workspace notification routes", () => {
  it("returns notifications for the local user", async () => {
    const ctx = await createWorkspaceTestContext("ws-notifications-rt");
    vi.mocked(listNotificationEvents).mockResolvedValueOnce({ events: [], unreadCount: 5 });
    vi.mocked(getWorkspaceNotifications).mockResolvedValueOnce([
      {
        id: "provider_expired_chatgpt",
        severity: "warning",
        kind: "provider_expired",
        title: "ChatGPT session expired",
        message: "Your ChatGPT session appears to be expired. Reconnect it to use chatgpt-web.",
        provider: "chatgpt",
        modelId: "chatgpt-web",
        action: { label: "Reconnect", href: "/connections" },
        dismissible: true,
        fingerprint: "provider_expired:chatgpt:2026-06-21T10:00:00.000Z",
        createdFromStatusAt: "2026-06-21T10:00:00.000Z"
      }
    ]);

    const app = buildApp();
    const response = await app.inject({ 
      method: "GET", 
      url: "/settings/notifications",
      headers: buildAuthHeaders(ctx)
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      notifications: [
        {
          kind: "provider_expired",
          provider: "chatgpt",
          action: { href: "/connections" }
        }
      ],
      unreadCount: 5
    });
    expect(getWorkspaceNotifications).toHaveBeenCalledWith(ctx.userId, {
      materializeEvents: true
    });

    await cleanupTestUserData(ctx.userId);
  });
});
