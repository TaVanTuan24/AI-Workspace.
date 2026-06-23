import { describe, it, expect } from "vitest";
import { getWorkspaceInviteEmailDeliveryPreflight } from "../emailDeliveryPreflightService.js";
import type { ApiEnv } from "../../../config/env.js";

describe("getWorkspaceInviteEmailDeliveryPreflight", () => {
  const baseEnv: Partial<ApiEnv> = {
    WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED: true,
    WORKSPACE_INVITE_EMAIL_PROVIDER: "smtp",
    WORKSPACE_INVITE_EMAIL_DRY_RUN: false,
    WORKSPACE_INVITE_EMAIL_ALLOW_REAL_SEND: true,
    WORKSPACE_INVITE_SMTP_HOST: "smtp.example.com",
    WORKSPACE_INVITE_SMTP_PORT: 587,
    WORKSPACE_INVITE_EMAIL_FROM: "noreply@example.com",
    NODE_ENV: "development",
  };

  it("returns noop default safe", () => {
    const env = { ...baseEnv, WORKSPACE_INVITE_EMAIL_PROVIDER: "noop" } as ApiEnv;
    const result = getWorkspaceInviteEmailDeliveryPreflight(env);
    expect(result.canAttemptSend).toBe(false);
    expect(result.realSendPossible).toBe(false);
    expect(result.provider).toBe("noop");
  });

  it("console dry-run cannot real send", () => {
    const env = { ...baseEnv, WORKSPACE_INVITE_EMAIL_PROVIDER: "console_dry_run" } as ApiEnv;
    const result = getWorkspaceInviteEmailDeliveryPreflight(env);
    expect(result.canAttemptSend).toBe(true);
    expect(result.realSendPossible).toBe(false);
  });

  it("smtp + enabled + dryRun true cannot real send", () => {
    const env = { ...baseEnv, WORKSPACE_INVITE_EMAIL_DRY_RUN: true } as ApiEnv;
    const result = getWorkspaceInviteEmailDeliveryPreflight(env);
    expect(result.canAttemptSend).toBe(true);
    expect(result.realSendPossible).toBe(false);
    expect(result.warnings).toContain("Dry-run mode is enabled. Real email will not be sent.");
  });

  it("smtp + enabled + dryRun false but allow false cannot real send", () => {
    const env = { ...baseEnv, WORKSPACE_INVITE_EMAIL_ALLOW_REAL_SEND: false } as ApiEnv;
    const result = getWorkspaceInviteEmailDeliveryPreflight(env);
    expect(result.canAttemptSend).toBe(true);
    expect(result.realSendPossible).toBe(false);
    expect(result.warnings).toContain("Real email send is not allowed. Set WORKSPACE_INVITE_EMAIL_ALLOW_REAL_SEND=true to enable.");
  });

  it("smtp + allow true but missing config cannot real send", () => {
    const env = { ...baseEnv, WORKSPACE_INVITE_SMTP_HOST: undefined } as ApiEnv;
    const result = getWorkspaceInviteEmailDeliveryPreflight(env);
    expect(result.canAttemptSend).toBe(true);
    expect(result.realSendPossible).toBe(false);
    expect(result.missingRequiredConfig).toContain("WORKSPACE_INVITE_SMTP_HOST");
    expect(result.warnings).toContain("Missing required SMTP configuration.");
  });

  it("smtp fully configured + allow true + dryRun false can real send", () => {
    const env = { ...baseEnv } as ApiEnv;
    const result = getWorkspaceInviteEmailDeliveryPreflight(env);
    expect(result.canAttemptSend).toBe(true);
    expect(result.realSendPossible).toBe(true);
    expect(result.missingRequiredConfig).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("test env never allows real send", () => {
    const env = { ...baseEnv, NODE_ENV: "test" } as ApiEnv;
    const result = getWorkspaceInviteEmailDeliveryPreflight(env);
    expect(result.canAttemptSend).toBe(true);
    expect(result.realSendPossible).toBe(false);
    expect(result.warnings).toContain("Real email send is permanently disabled in the test environment.");
  });
});
