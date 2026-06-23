import * as nodemailer from "nodemailer";
import type { ApiEnv } from "../../config/env.js";
import { getWorkspaceInviteEmailDeliveryPreflight } from "./emailDeliveryPreflightService.js";
import { redactSecrets } from "../../utils/redactSecrets.js";

export type EmailSendRequest = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailSendResult = {
  provider: "noop" | "smtp" | "resend" | "console_dry_run";
  status: "sent" | "skipped" | "failed";
  providerMessageId?: string;
  error?: string;
};

export interface EmailProvider {
  send(request: EmailSendRequest): Promise<EmailSendResult>;
}

export class NoopEmailProvider implements EmailProvider {
  async send(request: EmailSendRequest): Promise<EmailSendResult> {
    return {
      provider: "noop",
      status: "skipped",
      error: "No-op provider configured. Email delivery skipped."
    };
  }
}

export class ConsoleDryRunEmailProvider implements EmailProvider {
  async send(request: EmailSendRequest): Promise<EmailSendResult> {
    const parts = request.to.split("@");
    let redactedEmail = request.to;
    if (parts.length === 2) {
      const name = parts[0];
      const domain = parts[1];
      if (name.length > 2) {
        redactedEmail = `${name[0]}***${name[name.length - 1]}@${domain}`;
      } else {
        redactedEmail = `***@${domain}`;
      }
    }

    // Safely log the attempt without leaking the body (which contains the invite token)
    console.log(`[DRY-RUN EMAIL] To: ${redactedEmail} | Subject: ${request.subject}`);

    return {
      provider: "console_dry_run",
      status: "skipped",
      error: "Dry-run mode active. Check console for safely redacted logs."
    };
  }
}

export class SmtpEmailProvider implements EmailProvider {
  constructor(
    private host: string,
    private port: number,
    private from: string,
    private preflight: ReturnType<typeof getWorkspaceInviteEmailDeliveryPreflight>,
    private env: ApiEnv
  ) {}

  async send(request: EmailSendRequest): Promise<EmailSendResult> {
    if (this.env.NODE_ENV === "test") {
      return {
        provider: "smtp",
        status: "skipped",
        error: "real_send_not_allowed_in_test"
      };
    }

    if (this.env.WORKSPACE_INVITE_EMAIL_DRY_RUN) {
      return {
        provider: "smtp",
        status: "skipped",
        error: "skipped_dry_run"
      };
    }

    if (!this.env.WORKSPACE_INVITE_EMAIL_ALLOW_REAL_SEND) {
      return {
        provider: "smtp",
        status: "skipped",
        error: "real_send_not_allowed"
      };
    }

    if (!this.preflight.realSendPossible) {
      return {
        provider: "smtp",
        status: "failed",
        error: redactSecrets(`smtp_config_incomplete: ${this.preflight.warnings.join(" ")}`, this.env)
      };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: this.host,
        port: this.port,
        secure: this.env.WORKSPACE_INVITE_SMTP_SECURE,
        auth: (this.env.WORKSPACE_INVITE_SMTP_USER && this.env.WORKSPACE_INVITE_SMTP_PASSWORD) ? {
          user: this.env.WORKSPACE_INVITE_SMTP_USER,
          pass: this.env.WORKSPACE_INVITE_SMTP_PASSWORD
        } : undefined
      });

      const info = await transporter.sendMail({
        from: this.from,
        to: request.to,
        subject: request.subject,
        text: request.text,
        html: request.html
      });

      return {
        provider: "smtp",
        status: "sent",
        providerMessageId: info.messageId
      };
    } catch (error: any) {
      return {
        provider: "smtp",
        status: "failed",
        error: redactSecrets(error.message || String(error), this.env)
      };
    }
  }
}

export function createEmailProvider(env: ApiEnv): EmailProvider {
  const preflight = getWorkspaceInviteEmailDeliveryPreflight(env);

  if (!preflight.enabled) {
    return new NoopEmailProvider();
  }

  if (preflight.provider === "console_dry_run" || preflight.dryRun) {
    return new ConsoleDryRunEmailProvider();
  }

  if (preflight.provider === "smtp") {
    if (preflight.missingRequiredConfig.length > 0) {
      throw new Error(`Missing required SMTP configuration: ${preflight.missingRequiredConfig.join(", ")}`);
    }
    return new SmtpEmailProvider(
      env.WORKSPACE_INVITE_SMTP_HOST!,
      env.WORKSPACE_INVITE_SMTP_PORT!,
      env.WORKSPACE_INVITE_EMAIL_FROM!,
      preflight,
      env
    );
  }

  return new NoopEmailProvider();
}
