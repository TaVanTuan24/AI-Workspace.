import { prisma } from "./prisma.js";
import { env } from "../config/env.js";

export interface RecordInviteEmailNoopParams {
  workspaceId: string;
  inviteId: string;
  inviteeEmail: string;
  role: string;
  expiresAt: Date;
  templatePreviewSafe: boolean;
}

export async function recordInviteEmailNoop(params: RecordInviteEmailNoopParams) {
  const { workspaceId, inviteId, inviteeEmail, role, expiresAt, templatePreviewSafe } = params;

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

  const deliveryEnabled = env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED;
  const channel = env.WORKSPACE_INVITE_EMAIL_CHANNEL;
  const status = deliveryEnabled && channel !== "email_noop" ? "pending" : "skipped_not_configured";

  const reason = !deliveryEnabled
    ? "Email delivery disabled"
    : channel === "email_noop"
    ? "No-op channel configured"
    : "Queued for delivery";

  const attempt = await prisma.workspaceInviteDeliveryAttempt.create({
    data: {
      workspaceId,
      inviteId,
      channel,
      status,
      recipientEmailRedacted: redactedEmail,
      reason
    }
  });

  return attempt;
}
