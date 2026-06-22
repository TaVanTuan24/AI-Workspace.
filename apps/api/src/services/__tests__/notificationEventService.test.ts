import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../prisma.js";
import {
  materializeNotificationEvent,
  listNotificationEvents,
  markNotificationEventRead,
  markAllNotificationEventsRead,
  sanitizeNotificationMetadata
} from "../notificationEventService.js";
import type { WorkspaceNotification } from "@uaiw/shared/types/provider.js";

describe("notificationEventService", () => {
  const userId = "user-notify-test";

  beforeEach(async () => {
    await prisma.notificationEvent.deleteMany({
      where: { userId }
    });
    // Ensure user exists (create if not)
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: "notify@test.com",
        displayName: "Notify User"
      }
    });
  });

  const mockNotification: WorkspaceNotification = {
    id: "test_notif",
    severity: "warning",
    kind: "provider_limit_spike",
    title: "Test Alert",
    message: "This is a test alert",
    provider: "chatgpt",
    dismissible: true,
    fingerprint: "test:fingerprint:1"
  };

  it("should sanitize metadata", () => {
    const input = {
      provider: "chatgpt",
      prompt: "secret prompt",
      messages: [{ role: "user", content: "hi" }],
      rawKey: "sk-1234",
      hits24h: 15,
      threshold24h: 10,
      status: "error",
      cookie: "session_id=abc"
    };

    const sanitized = sanitizeNotificationMetadata(input);

    expect(sanitized).toEqual({
      provider: "chatgpt",
      hits24h: 15,
      threshold24h: 10,
      status: "error"
    });
    expect(sanitized.prompt).toBeUndefined();
    expect(sanitized.messages).toBeUndefined();
    expect(sanitized.rawKey).toBeUndefined();
    expect(sanitized.cookie).toBeUndefined();
  });

  it("should materialize an event as unread", async () => {
    const event = await materializeNotificationEvent(userId, mockNotification);

    expect(event.id).toBeDefined();
    expect(event.title).toBe("Test Alert");
    expect(event.readAt).toBeNull();
    expect(event.fingerprint).toBe("test:fingerprint:1");

    const listed = await listNotificationEvents({ userId });
    expect(listed.events).toHaveLength(1);
    expect(listed.unreadCount).toBe(1);
  });

  it("should dedupe events with same fingerprint without changing read state by default", async () => {
    const event1 = await materializeNotificationEvent(userId, mockNotification);
    
    // Mark it read
    await markNotificationEventRead(userId, event1.id);
    
    // Materialize again with same fingerprint
    const event2 = await materializeNotificationEvent(userId, {
      ...mockNotification,
      title: "Updated Alert Title"
    }, { updateExisting: true });

    expect(event2.id).toBe(event1.id);
    expect(event2.title).toBe("Updated Alert Title"); // Updated because we passed updateExisting: true
    expect(event2.readAt).not.toBeNull(); // Still read

    const listed = await listNotificationEvents({ userId });
    expect(listed.events).toHaveLength(1);
    expect(listed.unreadCount).toBe(0);
  });

  it("should create new unread event if fingerprint changes", async () => {
    await materializeNotificationEvent(userId, mockNotification);
    
    const event2 = await materializeNotificationEvent(userId, {
      ...mockNotification,
      fingerprint: "test:fingerprint:2",
      title: "Second Alert"
    });

    expect(event2.readAt).toBeNull();

    const listed = await listNotificationEvents({ userId });
    expect(listed.events).toHaveLength(2);
    expect(listed.unreadCount).toBe(2);
  });

  it("should mark all as read", async () => {
    await materializeNotificationEvent(userId, mockNotification);
    await materializeNotificationEvent(userId, {
      ...mockNotification,
      fingerprint: "test:fingerprint:2"
    });

    let listed = await listNotificationEvents({ userId });
    expect(listed.unreadCount).toBe(2);

    const result = await markAllNotificationEventsRead(userId);
    expect(result.updated).toBe(2);

    listed = await listNotificationEvents({ userId });
    expect(listed.unreadCount).toBe(0);
    expect(listed.events[0].readAt).not.toBeNull();
    expect(listed.events[1].readAt).not.toBeNull();
  });
});
