import { describe, it, expect, vi, beforeEach } from "vitest";
import { enqueueWebhookDeliveryRetry } from "../notificationWebhookRetryQueue.js";
import { isRetryableError, computeNextRetryDelayMs } from "../notificationDeliveryService.js";
import { env } from "../../config/env.js";

vi.mock("bullmq", () => {
  return {
    Queue: vi.fn().mockImplementation(() => ({
      add: vi.fn().mockResolvedValue({ id: "bull-job-123" }),
      close: vi.fn(),
    })),
  };
});
vi.mock("ioredis", () => {
  return {
    Redis: vi.fn().mockImplementation(() => ({
      quit: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn(),
    })),
  };
});

describe("Webhook Retry Scheduling", () => {
  const originalEnv = { ...env };

  beforeEach(() => {
    Object.assign(env, originalEnv);
    vi.clearAllMocks();
  });

  describe("isRetryableError", () => {
    it("should return true for timeouts and network errors", () => {
      expect(isRetryableError("timeout")).toBe(true);
      expect(isRetryableError("network_error")).toBe(true);
      expect(isRetryableError("delivery_provider_error")).toBe(true);
    });

    it("should return true for rate limits (429) and server errors (5xx)", () => {
      expect(isRetryableError("http_429")).toBe(true);
      expect(isRetryableError("http_500")).toBe(true);
      expect(isRetryableError("http_503")).toBe(true);
    });

    it("should return false for client errors (4xx) except 429", () => {
      expect(isRetryableError("http_400")).toBe(false);
      expect(isRetryableError("http_401")).toBe(false);
      expect(isRetryableError("http_403")).toBe(false);
      expect(isRetryableError("http_404")).toBe(false);
    });

    it("should return false for null/undefined or other generic errors", () => {
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
      expect(isRetryableError("secret_decryption_failed")).toBe(false);
    });
  });

  describe("computeNextRetryDelayMs", () => {
    it("should return null if retries are disabled", () => {
      env.NOTIFICATION_WEBHOOK_RETRY_ENABLED = false;
      expect(computeNextRetryDelayMs(1)).toBeNull();
    });

    it("should return null if max attempts reached", () => {
      env.NOTIFICATION_WEBHOOK_RETRY_ENABLED = true;
      env.NOTIFICATION_WEBHOOK_RETRY_MAX_ATTEMPTS = 5;
      expect(computeNextRetryDelayMs(5)).toBeNull();
      expect(computeNextRetryDelayMs(6)).toBeNull();
    });

    it("should compute delay with exponential backoff and jitter", () => {
      env.NOTIFICATION_WEBHOOK_RETRY_ENABLED = true;
      env.NOTIFICATION_WEBHOOK_RETRY_MAX_ATTEMPTS = 5;
      env.NOTIFICATION_WEBHOOK_RETRY_BASE_DELAY_MS = 1000;
      env.NOTIFICATION_WEBHOOK_RETRY_MAX_DELAY_MS = 10000;

      // Mock random for predictable jitter
      const mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5); // jitter = 0.8 + 0.5 * 0.4 = 1.0

      expect(computeNextRetryDelayMs(1)).toBe(1000); // 1000 * 2^0 * 1.0 = 1000
      expect(computeNextRetryDelayMs(2)).toBe(2000); // 1000 * 2^1 * 1.0 = 2000
      expect(computeNextRetryDelayMs(3)).toBe(4000); // 1000 * 2^2 * 1.0 = 4000
      expect(computeNextRetryDelayMs(4)).toBe(8000); // 1000 * 2^3 * 1.0 = 8000
      
      mathRandomSpy.mockRestore();
    });
    
    it("should cap at max delay", () => {
      env.NOTIFICATION_WEBHOOK_RETRY_ENABLED = true;
      env.NOTIFICATION_WEBHOOK_RETRY_MAX_ATTEMPTS = 10;
      env.NOTIFICATION_WEBHOOK_RETRY_BASE_DELAY_MS = 1000;
      env.NOTIFICATION_WEBHOOK_RETRY_MAX_DELAY_MS = 5000;
      
      const mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
      
      expect(computeNextRetryDelayMs(5)).toBe(5000); // min(1000 * 2^4, 5000) = 5000
      
      mathRandomSpy.mockRestore();
    });
  });

  describe("enqueueWebhookDeliveryRetry", () => {
    it("should enqueue a job to BullMQ", async () => {
      const result = await enqueueWebhookDeliveryRetry({
        userId: "user-1",
        notificationEventId: "evt-1",
        delayMs: 5000,
        attemptNumber: 2,
        reason: "network_error"
      });

      expect(result.jobId).toBe("webhook-retry:user-1:evt-1:2");
    });
  });
});
