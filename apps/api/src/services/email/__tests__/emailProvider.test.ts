import { describe, expect, it, vi } from "vitest";
import { createEmailProvider, NoopEmailProvider, ConsoleDryRunEmailProvider, SmtpEmailProvider } from "../emailProvider.js";
import type { ApiEnv } from "../../../config/env.js";

vi.mock("nodemailer", () => {
  return {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(async () => ({ messageId: "mock-message-id" }))
    }))
  };
});

describe("createEmailProvider", () => {
  it("returns NoopEmailProvider when delivery is disabled", () => {
    const env = { WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED: false } as ApiEnv;
    const provider = createEmailProvider(env);
    expect(provider).toBeInstanceOf(NoopEmailProvider);
  });

  it("returns ConsoleDryRunEmailProvider when dry run is enabled", () => {
    const env = {
      WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED: true,
      WORKSPACE_INVITE_EMAIL_DRY_RUN: true,
      WORKSPACE_INVITE_EMAIL_PROVIDER: "smtp"
    } as ApiEnv;
    const provider = createEmailProvider(env);
    expect(provider).toBeInstanceOf(ConsoleDryRunEmailProvider);
  });

  it("returns ConsoleDryRunEmailProvider when provider is console_dry_run", () => {
    const env = {
      WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED: true,
      WORKSPACE_INVITE_EMAIL_DRY_RUN: false,
      WORKSPACE_INVITE_EMAIL_PROVIDER: "console_dry_run"
    } as unknown as ApiEnv;
    const provider = createEmailProvider(env);
    expect(provider).toBeInstanceOf(ConsoleDryRunEmailProvider);
  });

  it("returns SmtpEmailProvider when configured", async () => {
    const env = {
      WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED: true,
      WORKSPACE_INVITE_EMAIL_DRY_RUN: false,
      WORKSPACE_INVITE_EMAIL_ALLOW_REAL_SEND: false,
      WORKSPACE_INVITE_EMAIL_PROVIDER: "smtp",
      WORKSPACE_INVITE_SMTP_HOST: "smtp.example.com",
      WORKSPACE_INVITE_SMTP_PORT: 587,
      WORKSPACE_INVITE_EMAIL_FROM: "noreply@example.com"
    } as unknown as ApiEnv;
    const provider = createEmailProvider(env);
    expect(provider).toBeInstanceOf(SmtpEmailProvider);

    const res = await provider.send({ to: "test@example.com", subject: "test", text: "test" });
    expect(res.status).toBe("skipped");
    expect(res.error).toMatch(/real_send_not_allowed/);
  });

  it("throws error when smtp is missing config", () => {
    const env = {
      WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED: true,
      WORKSPACE_INVITE_EMAIL_DRY_RUN: false,
      WORKSPACE_INVITE_EMAIL_ALLOW_REAL_SEND: true,
      WORKSPACE_INVITE_EMAIL_PROVIDER: "smtp"
    } as unknown as ApiEnv;
    expect(() => createEmailProvider(env)).toThrowError(/Missing required SMTP configuration/);
  });

  it("blocks real send unconditionally in test env", async () => {
    const env = {
      NODE_ENV: "test",
      WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED: true,
      WORKSPACE_INVITE_EMAIL_DRY_RUN: false,
      WORKSPACE_INVITE_EMAIL_ALLOW_REAL_SEND: true,
      WORKSPACE_INVITE_EMAIL_PROVIDER: "smtp",
      WORKSPACE_INVITE_SMTP_HOST: "smtp.example.com",
      WORKSPACE_INVITE_SMTP_PORT: 587,
      WORKSPACE_INVITE_EMAIL_FROM: "noreply@example.com"
    } as unknown as ApiEnv;
    const provider = createEmailProvider(env);
    expect(provider).toBeInstanceOf(SmtpEmailProvider);

    const res = await provider.send({ to: "test@example.com", subject: "test", text: "test" });
    expect(res.status).toBe("skipped");
    expect(res.error).toBe("real_send_not_allowed_in_test");
  });

  it("sends real email when completely configured and not in test env", async () => {
    const env = {
      NODE_ENV: "production",
      WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED: true,
      WORKSPACE_INVITE_EMAIL_DRY_RUN: false,
      WORKSPACE_INVITE_EMAIL_ALLOW_REAL_SEND: true,
      WORKSPACE_INVITE_EMAIL_PROVIDER: "smtp",
      WORKSPACE_INVITE_SMTP_HOST: "smtp.example.com",
      WORKSPACE_INVITE_SMTP_PORT: 587,
      WORKSPACE_INVITE_EMAIL_FROM: "noreply@example.com"
    } as unknown as ApiEnv;
    const provider = createEmailProvider(env);
    expect(provider).toBeInstanceOf(SmtpEmailProvider);

    const res = await provider.send({ to: "test@example.com", subject: "test", text: "test" });
    expect(res.status).toBe("sent");
    expect(res.providerMessageId).toBe("mock-message-id");
  });
});
