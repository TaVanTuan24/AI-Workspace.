import type { ApiEnv } from "../../config/env.js";

export interface WorkspaceInviteEmailDeliveryPreflight {
  enabled: boolean;
  provider: "noop" | "console_dry_run" | "smtp";
  dryRun: boolean;
  allowRealSend: boolean;
  canAttemptSend: boolean;
  realSendPossible: boolean;
  missingRequiredConfig: string[];
  warnings: string[];
  fromConfigured: boolean;
  baseUrlConfigured: boolean;
}

export function getWorkspaceInviteEmailDeliveryPreflight(env: ApiEnv): WorkspaceInviteEmailDeliveryPreflight {
  const enabled = env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED;
  const provider = env.WORKSPACE_INVITE_EMAIL_PROVIDER;
  const dryRun = env.WORKSPACE_INVITE_EMAIL_DRY_RUN;
  const allowRealSend = env.WORKSPACE_INVITE_EMAIL_ALLOW_REAL_SEND;

  const missingRequiredConfig: string[] = [];
  const warnings: string[] = [];

  const fromConfigured = !!env.WORKSPACE_INVITE_EMAIL_FROM;
  const baseUrlConfigured = !!env.WORKSPACE_INVITE_BASE_URL;

  let canAttemptSend = false;
  let realSendPossible = false;

  if (!enabled) {
    return {
      enabled,
      provider,
      dryRun,
      allowRealSend,
      canAttemptSend: false,
      realSendPossible: false,
      missingRequiredConfig,
      warnings,
      fromConfigured,
      baseUrlConfigured
    };
  }

  if (provider === "console_dry_run") {
    canAttemptSend = true;
    realSendPossible = false;
  } else if (provider === "noop") {
    canAttemptSend = false;
    realSendPossible = false;
  } else if (provider === "smtp") {
    canAttemptSend = true;
    
    if (!env.WORKSPACE_INVITE_SMTP_HOST) missingRequiredConfig.push("WORKSPACE_INVITE_SMTP_HOST");
    if (!env.WORKSPACE_INVITE_SMTP_PORT) missingRequiredConfig.push("WORKSPACE_INVITE_SMTP_PORT");
    if (!env.WORKSPACE_INVITE_EMAIL_FROM) missingRequiredConfig.push("WORKSPACE_INVITE_EMAIL_FROM");

    if (env.NODE_ENV === "test") {
      warnings.push("Real email send is permanently disabled in the test environment.");
      realSendPossible = false;
    } else if (missingRequiredConfig.length > 0) {
      warnings.push("Missing required SMTP configuration.");
      realSendPossible = false;
    } else if (dryRun) {
      warnings.push("Dry-run mode is enabled. Real email will not be sent.");
      realSendPossible = false;
    } else if (!allowRealSend) {
      warnings.push("Real email send is not allowed. Set WORKSPACE_INVITE_EMAIL_ALLOW_REAL_SEND=true to enable.");
      realSendPossible = false;
    } else {
      realSendPossible = true;
    }
  }

  return {
    enabled,
    provider,
    dryRun,
    allowRealSend,
    canAttemptSend,
    realSendPossible,
    missingRequiredConfig,
    warnings,
    fromConfigured,
    baseUrlConfigured
  };
}
