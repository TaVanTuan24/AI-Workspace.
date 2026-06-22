import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deliverNotificationEvent } from "../notificationDeliveryService.js";
import { prisma } from "../prisma.js";
import { encryptSecretString } from "../secretBoxService.js";

vi.mock("../prisma.js", () => ({
  prisma: {
    notificationDeliveryPreference: {
      findMany: vi.fn(),
      findUnique: vi.fn()
    },
    notificationWebhookDestination: {
      findMany: vi.fn(),
      findUnique: vi.fn()
    },
    notificationDeliveryAttempt: {
      create: vi.fn().mockImplementation(async ({ data }) => ({
        ...data,
        id: "mock_id",
        attemptedAt: new Date(),
        attemptNumber: data.attemptNumber ?? 1,
        retryable: data.retryable ?? false,
        nextRetryAt: data.nextRetryAt ?? null
      }))
    }
  }
}));

vi.mock("../notificationWebhookRetryQueue.js", () => ({
  enqueueWebhookDeliveryRetry: vi.fn().mockResolvedValue({ jobId: "mock_job_id" })
}));

describe("notificationDeliveryService - Webhook Provider", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    process.env.SESSION_MASTER_KEY = Buffer.alloc(32, "a").toString("hex");
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SESSION_MASTER_KEY;
    globalThis.fetch = originalFetch;
  });

  it("skips delivery if webhook is not configured", async () => {
    vi.mocked(prisma.notificationWebhookDestination.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notificationDeliveryPreference.findMany).mockResolvedValue([
      { userId: "u1", channel: "webhook", enabled: true, configJson: null }
    ] as any);
    vi.mocked(prisma.notificationDeliveryPreference.findUnique).mockResolvedValue(null);

    const attempts = await deliverNotificationEvent("u1", {
      id: "test1",
      kind: "test_webhook",
      severity: "info",
      title: "Test",
      message: "Message",
      createdAt: new Date().toISOString(),
      fingerprint: "test"
    });

    const webhookAttempt = attempts.find(a => a.channel === "webhook");
    expect(webhookAttempt).toBeDefined();
    expect(webhookAttempt!.status).toBe("skipped_not_configured");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("delivers successfully with valid config and signs payload", async () => {
    const rawSecret = "uaiw_whsec_testsecret";
    const encryptedSigningSecret = encryptSecretString(rawSecret);
    
    const configJson = JSON.stringify({
      url: "https://example.com/webhook",
      encryptedSigningSecret
    });

    vi.mocked(prisma.notificationWebhookDestination.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notificationDeliveryPreference.findMany).mockResolvedValue([
      { userId: "u1", channel: "webhook", enabled: true, configJson }
    ] as any);

    vi.mocked(prisma.notificationDeliveryPreference.findUnique).mockResolvedValue({
      userId: "u1",
      channel: "webhook",
      enabled: true,
      configJson
    } as any);

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200
    } as any);

    // Don't mock out prisma.create completely or else it returns `{}` instead of the default mock behavior
    // vi.mocked(prisma.notificationDeliveryAttempt.create).mockResolvedValue({} as any);

    const attempts = await deliverNotificationEvent("u1", {
      id: "test2",
      kind: "test_webhook",
      severity: "info",
      title: "Test",
      message: "Message",
      createdAt: new Date().toISOString(),
      fingerprint: "test"
    });

    const webhookAttempt = attempts.find(a => a.channel === "webhook");
    expect(webhookAttempt).toBeDefined();
    expect(webhookAttempt!.status).toBe("delivered");
    
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const fetchCallArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(fetchCallArgs[0]).toBe("https://example.com/webhook");
    
    const options = fetchCallArgs[1] as any;
    expect(options.method).toBe("POST");
    expect(options.headers["X-UAIW-Signature"]).toContain("sha256=");
    expect(options.headers["X-UAIW-Event-Id"]).toBe("test2");
    expect(options.headers["Content-Type"]).toBe("application/json");

    // The payload should be correctly structured
    const body = JSON.parse(options.body);
    expect(body.id).toBe("test2");
    expect(body.type).toBe("test.event");
    expect(body.notification.message).toBe("Message");
  });

  it("handles fetch errors (failed delivery)", async () => {
    const rawSecret = "uaiw_whsec_testsecret";
    const encryptedSigningSecret = encryptSecretString(rawSecret);
    
    const configJson = JSON.stringify({
      url: "https://example.com/webhook",
      encryptedSigningSecret
    });

    vi.mocked(prisma.notificationWebhookDestination.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notificationDeliveryPreference.findMany).mockResolvedValue([
      { userId: "u1", channel: "webhook", enabled: true, configJson }
    ] as any);

    vi.mocked(prisma.notificationDeliveryPreference.findUnique).mockResolvedValue({
      userId: "u1",
      channel: "webhook",
      enabled: true,
      configJson
    } as any);

    // Mock non-ok response
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 500
    } as any);

    const attempts = await deliverNotificationEvent("u1", {
      id: "test3",
      kind: "test_webhook",
      severity: "info",
      title: "Test",
      message: "Message",
      createdAt: new Date().toISOString(),
      fingerprint: "test"
    });

    const webhookAttempt = attempts.find(a => a.channel === "webhook");
    expect(webhookAttempt).toBeDefined();
    expect(webhookAttempt!.status).toBe("failed");
    expect(webhookAttempt!.errorCode).toBe("http_500");
  });
});
