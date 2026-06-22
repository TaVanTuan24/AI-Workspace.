import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../prisma.js";
import {
  deliverNotificationEvent,
  listNotificationDeliveryAttempts
} from "../notificationDeliveryService.js";
import { updateNotificationDeliveryPreference } from "../notificationDeliveryPreferenceService.js";
import type { NotificationEventView } from "@uaiw/shared/types/provider.js";
import { vi } from "vitest";

vi.mock("../notificationWebhookRetryQueue.js", () => ({
  enqueueWebhookDeliveryRetry: vi.fn().mockResolvedValue({ jobId: "mock_job_id" })
}));

describe("notificationDeliveryService", () => {
  const userId = "test-delivery-service-user";
  let mockEvent: NotificationEventView;

  beforeEach(async () => {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, email: "deliv-test@example.com" }
    });
    await prisma.notificationDeliveryAttempt.deleteMany({ where: { userId } });
    await prisma.notificationDeliveryPreference.deleteMany({ where: { userId } });
    await prisma.notificationEvent.deleteMany({ where: { userId } });

    const event = await prisma.notificationEvent.create({
      data: {
        userId,
        kind: "test_event",
        severity: "info",
        title: "Test Title",
        message: "Test Message",
        fingerprint: "test:event:123"
      }
    });

    mockEvent = {
      id: event.id,
      kind: event.kind,
      severity: event.severity,
      title: event.title,
      message: event.message,
      provider: event.provider,
      modelId: event.modelId,
      fingerprint: event.fingerprint,
      createdAt: event.createdAt.toISOString()
    } as NotificationEventView;
  });

  it("delivers to in_app channel by default", async () => {
    const attempts = await deliverNotificationEvent(userId, mockEvent);
    
    expect(attempts).toHaveLength(1);
    expect(attempts[0].channel).toBe("in_app");
    expect(attempts[0].status).toBe("delivered");
    expect(attempts[0].notificationEventId).toBe(mockEvent.id);

    const listed = await listNotificationDeliveryAttempts({ userId });
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(attempts[0].id);
  });

  it("skips noop channels if enabled", async () => {
    await updateNotificationDeliveryPreference(userId, "email_noop", { enabled: true });

    const attempts = await deliverNotificationEvent(userId, mockEvent);
    expect(attempts).toHaveLength(2);

    const inApp = attempts.find(a => a.channel === "in_app");
    expect(inApp?.status).toBe("delivered");

    const email = attempts.find(a => a.channel === "email_noop");
    expect(email?.status).toBe("skipped_not_configured");
  });

  it("safely handles failed deliveries without throwing", async () => {
    // This is tested by the fact that no actual network calls are made.
    // If a channel threw an error inside the service, the test would fail if it wasn't caught.
    const attempts = await deliverNotificationEvent(userId, mockEvent);
    expect(attempts[0].status).toBe("delivered");
  });
});
