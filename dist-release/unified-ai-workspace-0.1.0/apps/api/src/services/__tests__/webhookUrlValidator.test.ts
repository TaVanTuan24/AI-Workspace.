import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateWebhookUrl } from "../webhookUrlValidator.js";
import { env } from "../../config/env.js";

describe("webhookUrlValidator", () => {
  const originalEnv = { ...env };

  beforeEach(() => {
    vi.resetModules();
    env.NODE_ENV = "development";
    env.NOTIFICATION_WEBHOOK_ALLOW_LOCALHOST = false;
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
  });

  it("accepts a valid https URL", async () => {
    const url = await validateWebhookUrl("https://example.com/webhook", false);
    expect(url.hostname).toBe("example.com");
  });

  it("rejects invalid URL format", async () => {
    await expect(validateWebhookUrl("not-a-url", false)).rejects.toThrow("Invalid URL format");
  });

  it("rejects forbidden protocols", async () => {
    await expect(validateWebhookUrl("file:///etc/passwd", false)).rejects.toThrow("Unsupported protocol");
    await expect(validateWebhookUrl("ftp://example.com/test", false)).rejects.toThrow("Unsupported protocol");
  });

  it("rejects HTTP in production unless allowed", async () => {
    env.NODE_ENV = "production";
    await expect(validateWebhookUrl("http://example.com", false)).rejects.toThrow("HTTPS is required");

    env.NOTIFICATION_WEBHOOK_ALLOW_LOCALHOST = true;
    const url = await validateWebhookUrl("http://example.com", false);
    expect(url.protocol).toBe("http:");
  });

  it("rejects embedded credentials", async () => {
    await expect(validateWebhookUrl("https://user:pass@example.com", false)).rejects.toThrow("embedded credentials");
  });

  it("rejects localhost by default", async () => {
    await expect(validateWebhookUrl("https://localhost/test", false)).rejects.toThrow("Localhost webhooks are not allowed");
    await expect(validateWebhookUrl("https://127.0.0.1/test", false)).rejects.toThrow("Localhost webhooks are not allowed");
  });

  it("allows localhost if explicitly permitted", async () => {
    env.NOTIFICATION_WEBHOOK_ALLOW_LOCALHOST = true;
    const url = await validateWebhookUrl("https://localhost/test", false);
    expect(url.hostname).toBe("localhost");
  });

  it("rejects private IPs", async () => {
    const testCases = [
      "https://10.0.0.1",
      "https://172.16.0.1",
      "https://192.168.1.1",
      "https://169.254.169.254",
      "https://[::1]",
      "https://[fd00::1]"
    ];

    for (const ip of testCases) {
      await expect(validateWebhookUrl(ip, true)).rejects.toThrow(/Private or local|Localhost webhooks/);
    }
  });
});
