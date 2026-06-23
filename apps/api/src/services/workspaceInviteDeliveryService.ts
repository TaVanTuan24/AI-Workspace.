import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import { createEmailProvider } from "./email/emailProvider.js";
import { redactSecrets } from "../utils/redactSecrets.js";
import { assertWorkspaceQuota } from "./workspaceQuotaService.js";

export interface DeliverInviteEmailParams {
  workspaceId: string;
  inviteId: string;
  inviteeEmail: string;
  subject: string;
  text: string;
  html?: string;
}

export async function deliverInviteEmail(params: DeliverInviteEmailParams) {
  const { workspaceId, inviteId, inviteeEmail, subject, text, html } = params;

  await assertWorkspaceQuota({ workspaceId, resource: 'monthlyInviteEmails' });

  // Redact the email to store safely (e.g. j***@example.com)
  const parts = inviteeEmail.split("@");
  let redactedEmail = inviteeEmail;
  if (parts.length === 2) {
    const name = parts[0];
    const domain = parts[1];
    if (name.length > 2) {
      redactedEmail = `${name[0]}***${name[name.length - 1]}@${domain}`;
    } else {
      redactedEmail = `***@${domain}`;
    }
  }

  const provider = createEmailProvider(env);
  
  let channel = "email_noop";
  let defaultDbStatus = "skipped_not_configured";
  
  if (env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED) {
    if (env.WORKSPACE_INVITE_EMAIL_PROVIDER === "console_dry_run" || env.WORKSPACE_INVITE_EMAIL_DRY_RUN) {
      channel = "email_dry_run";
      defaultDbStatus = "skipped_dry_run";
    } else if (env.WORKSPACE_INVITE_EMAIL_PROVIDER === "smtp") {
      channel = "email_smtp";
      defaultDbStatus = "pending";
    }
  }

  const result = await provider.send({
    to: inviteeEmail,
    subject,
    text,
    html
  });

  let finalStatus: string = result.status;
  if (result.status === "skipped" || result.status === "failed") {
    if (result.error?.startsWith("real_send_not_allowed_in_test")) finalStatus = "skipped_real_send_not_allowed_in_test";
    else if (result.error?.startsWith("real_send_not_allowed")) finalStatus = "skipped_real_send_not_allowed";
    else if (result.error?.startsWith("skipped_dry_run")) finalStatus = "skipped_dry_run";
    else if (result.error?.startsWith("smtp_config_incomplete")) finalStatus = "smtp_config_incomplete";
    else if (result.status === "skipped" && defaultDbStatus.startsWith("skipped")) finalStatus = defaultDbStatus;
  }

  const attempt = await prisma.workspaceInviteDeliveryAttempt.create({
    data: {
      workspaceId,
      inviteId,
      channel,
      status: finalStatus,
      recipientEmailRedacted: redactedEmail,
      reason: result.error ? redactSecrets(result.error, env) : "Processed"
    }
  });

  return {
    channel,
    status: attempt.status
  };
}
