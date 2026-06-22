import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "../../services/prisma.js";
import { notificationEventsRoutes } from "../notificationEvents.js";
import { materializeNotificationEvent } from "../../services/notificationEventService.js";
import type { NotificationEventView, WorkspaceNotification } from "@uaiw/shared/types/provider.js";

describe("notificationEvents routes", () => {
  let app: FastifyInstance;
  const userId = "local-user"; // Auth middleware usually mocks "local-user" in tests

  beforeAll(async () => {
    app = Fastify();
    
    // Mock attachLocalUser middleware
    app.addHook("preHandler", async (request) => {
      request.user = { id: userId } as any;
    });

    await app.register(notificationEventsRoutes);
    await app.ready();

    // Ensure user exists
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: "route-test@local.com",
        displayName: "Route Test User"
      }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.notificationEvent.deleteMany({
      where: { userId }
    });
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
    await materializeNotificationEvent(userId, mockNotif);

    const response = await app.inject({
      method: "GET",
      url: "/settings/notification-events"
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].title).toBe("Spike Alert");
    expect(data.unreadCount).toBe(1);
  });

  it("PATCH /settings/notification-events/:id/read > marks event read", async () => {
    const event = await materializeNotificationEvent(userId, mockNotif);

    const response = await app.inject({
      method: "PATCH",
      url: `/settings/notification-events/${event.id}/read`
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.event.readAt).not.toBeNull();

    const listResp = await app.inject({
      method: "GET",
      url: "/settings/notification-events"
    });
    expect(listResp.json().unreadCount).toBe(0);
  });

  it("PATCH /settings/notification-events/read-all > marks all read", async () => {
    await materializeNotificationEvent(userId, mockNotif);
    await materializeNotificationEvent(userId, {
      ...mockNotif,
      fingerprint: "route:test:2"
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/settings/notification-events/read-all"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().updated).toBe(2);

    const listResp = await app.inject({
      method: "GET",
      url: "/settings/notification-events"
    });
    expect(listResp.json().unreadCount).toBe(0);
  });
});
