import { escape } from "html-escaper";

export interface RenderInviteEmailParams {
  workspaceName: string;
  inviterName: string;
  inviteeEmail: string;
  role: string;
  acceptUrl?: string;
  expiresAt: Date;
  deliveryEnabled?: boolean;
}

export interface RenderInviteEmailResult {
  subject: string;
  text: string;
  html?: string;
}

export function renderInviteEmailPreview({
  workspaceName,
  inviterName,
  inviteeEmail,
  role,
  acceptUrl,
  expiresAt,
  deliveryEnabled
}: RenderInviteEmailParams): RenderInviteEmailResult {
  const safeWorkspace = escape(workspaceName);
  const safeInviter = escape(inviterName);
  const safeRole = escape(role);
  const expiryStr = expiresAt.toLocaleString();

  const subject = `You were invited to ${workspaceName} on Unified AI Workspace`;

  const textLines = [
    `Hello,`,
    ``,
    `${inviterName} has invited you to join the workspace "${workspaceName}" as a ${role}.`,
    ``,
    `This invite will expire on ${expiryStr}.`,
    ``
  ];

  if (acceptUrl) {
    textLines.push(`To accept the invite, please click the link below:`);
    textLines.push(acceptUrl);
    textLines.push(``);
    if (!deliveryEnabled) {
      textLines.push(`Note: Email delivery is not configured yet. This link was shown when the invite was created.`);
    }
  } else if (!deliveryEnabled) {
    textLines.push(`Note: Email delivery is not configured yet. Please ask the workspace owner for the invite link.`);
  }

  const text = textLines.join("\n");

  let htmlBody = `
    <p>Hello,</p>
    <p><strong>${safeInviter}</strong> has invited you to join the workspace <strong>"${safeWorkspace}"</strong> as a <strong>${safeRole}</strong>.</p>
    <p>This invite will expire on ${escape(expiryStr)}.</p>
  `;

  if (acceptUrl) {
    htmlBody += `
      <p>To accept the invite, please click the link below:</p>
      <p><a href="${escape(acceptUrl)}">${escape(acceptUrl)}</a></p>
    `;
    if (!deliveryEnabled) {
      htmlBody += `<p><em>Note: Email delivery is not configured yet. This link was shown when the invite was created.</em></p>`;
    }
  } else if (!deliveryEnabled) {
    htmlBody += `
      <p><em>Note: Email delivery is not configured yet. Please ask the workspace owner for the invite link.</em></p>
    `;
  }

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${escape(subject)}</title>
      </head>
      <body>
        ${htmlBody}
      </body>
    </html>
  `;

  return {
    subject,
    text,
    html
  };
}
