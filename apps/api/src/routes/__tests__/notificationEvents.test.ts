import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { notificationEventsRoutes } from "../notificationEvents.js";
import { materializeNotificationEvent } from "../../services/notificationEventService.js";
import type { NotificationEventView, WorkspaceNotification } from "@uaiw/shared/types/provider.js";
import { createWorkspaceTestContext, type WorkspaceTestContext, buildAuthHeaders } from "../../test/workspaceTestContext.js";
import { cleanupTestUserData } from "../../test/testIsolation.js";

describe("notificationEvents routes", () => {
  let app: FastifyInstance;
  let ctx: WorkspaceTestContext;

  beforeAll(async () => {
    app = Fastify();
    await app.register(notificationEventsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    ctx = await createWorkspaceTestContext("route-notif-events");
  });

  afterEach(async () => {
    if (ctx) await cleanupTestUserData(ctx.userId);
  });

  const mockNotif: WorkspaceNotification = {
    id: "test",
    severity: "warning",
    kind: "provider_limit_spike",
    title: "Spike Alert",
    message: "Hit limit",
    dismissible: true,
    fingerprint: "route:test:1"
  };

  it("GET /settings/notification-events > lists events and unread count", async () => {
    await materializeNotificationEvent(ctx.userId, mockNotif);

    const response = await app.inject({
      method: "GET",
      url: "/settings/notification-events",
      headers: buildAuthHeaders(ctx)
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].title).toBe("Spike Alert");
    expect(data.unreadCount).toBe(1);
  });

  it("PATCH /settings/notification-events/:id/read > marks event read", async () => {
    const event = await materializeNotificationEvent(ctx.userId, mockNotif);

    const response = await app.inject({
      method: "PATCH",
      url: `/settings/notification-events/${event.id}/read`,
      headers: buildAuthHeaders(ctx)
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.event.readAt).not.toBeNull();

    const listResp = await app.inject({
      method: "GET",
      url: "/settings/notification-events",
      headers: buildAuthHeaders(ctx)
    });
    expect(listResp.json().unreadCount).toBe(0);
  });

  it("PATCH /settings/notification-events/read-all > marks all read", async () => {
    await materializeNotificationEvent(ctx.userId, mockNotif);
    await materializeNotificationEvent(ctx.userId, {
      ...mockNotif,
      fingerprint: "route:test:2"
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/settings/notification-events/read-all",
      headers: buildAuthHeaders(ctx)
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().updated).toBe(2);

    const listResp = await app.inject({
      method: "GET",
      url: "/settings/notification-events",
      headers: buildAuthHeaders(ctx)
    });
    expect(listResp.json().unreadCount).toBe(0);
  });
});
