import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { deliverInviteEmail } from "../workspaceInviteDeliveryService.js";
import { createWorkspaceTestContext, type WorkspaceTestContext } from "../../test/workspaceTestContext.js";
import { cleanupTestUserData } from "../../test/testIsolation.js";
import { createWorkspaceInvite } from "../workspaceInviteService.js";
import { env } from "../../config/env.js";

describe("workspaceInviteDeliveryService", () => {
  let ctx: WorkspaceTestContext;
  let inviteId: string;

  beforeEach(async () => {
    ctx = await createWorkspaceTestContext("ws-delivery-rt");

    const result = await createWorkspaceInvite({
      workspaceId: ctx.workspaceId,
      email: "invitee@example.com",
      role: "member",
      actorUserId: ctx.userId
    });
    inviteId = result.invite.id;
  });

  afterEach(async () => {
    if (ctx) await cleanupTestUserData(ctx.userId);
  });

  it("records a delivery attempt and redacts email", async () => {
    const originalDelivery = env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED;
    env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED = false;
    try {
      const attempt = await deliverInviteEmail({
      workspaceId: ctx.workspaceId,
      inviteId,
      inviteeEmail: "hello-world@example.com",
      subject: "Test",
      text: "Text",
      html: "HTML"
    });

    expect(attempt.channel).toBe("email_noop");
      expect(attempt.status).toBe("skipped_not_configured");
    } finally {
      env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED = originalDelivery;
    }
  });

  it("redacts short emails securely", async () => {
    const originalDelivery = env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED;
    env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED = false;
    try {
      const attempt = await deliverInviteEmail({
        workspaceId: ctx.workspaceId,
        inviteId,
        inviteeEmail: "me@example.com",
        subject: "Test",
        text: "Text",
        html: "HTML"
      });

      expect(attempt.channel).toBe("email_noop");
    } finally {
      env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED = originalDelivery;
    }
  });

  it("records a dry_run skipped attempt when dry_run is enabled", async () => {
    const originalDelivery = env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED;
    const originalDryRun = env.WORKSPACE_INVITE_EMAIL_DRY_RUN;
    const originalProvider = env.WORKSPACE_INVITE_EMAIL_PROVIDER;

    try {
      env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED = true;
      env.WORKSPACE_INVITE_EMAIL_DRY_RUN = true;
      env.WORKSPACE_INVITE_EMAIL_PROVIDER = "console_dry_run";

      const attempt = await deliverInviteEmail({
        workspaceId: ctx.workspaceId,
        inviteId,
        inviteeEmail: "hello-world@example.com",
        subject: "Test",
        text: "Text",
        html: "HTML"
      });

      expect(attempt.channel).toBe("email_dry_run");
      expect(attempt.status).toBe("skipped_dry_run");
    } finally {
      env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED = originalDelivery;
      env.WORKSPACE_INVITE_EMAIL_DRY_RUN = originalDryRun;
      env.WORKSPACE_INVITE_EMAIL_PROVIDER = originalProvider;
    }
  });
});
