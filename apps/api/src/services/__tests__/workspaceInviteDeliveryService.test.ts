import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { recordInviteEmailNoop } from "../workspaceInviteDeliveryService.js";
import { createWorkspaceTestContext, type WorkspaceTestContext } from "../../test/workspaceTestContext.js";
import { cleanupTestUserData } from "../../test/testIsolation.js";
import { createWorkspaceInvite } from "../workspaceInviteService.js";

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
    const attempt = await recordInviteEmailNoop({
      workspaceId: ctx.workspaceId,
      inviteId,
      inviteeEmail: "hello-world@example.com",
      role: "member",
      expiresAt: new Date(),
      templatePreviewSafe: true
    });

    expect(attempt.channel).toBe("email_noop");
    expect(attempt.status).toBe("skipped_not_configured");
    expect(attempt.recipientEmailRedacted).toBe("h***d@example.com");

    const jsonStr = JSON.stringify(attempt);
    expect(jsonStr).not.toContain("hello-world@example.com");
  });

  it("redacts short emails securely", async () => {
    const attempt = await recordInviteEmailNoop({
      workspaceId: ctx.workspaceId,
      inviteId,
      inviteeEmail: "me@example.com",
      role: "member",
      expiresAt: new Date(),
      templatePreviewSafe: true
    });

    expect(attempt.recipientEmailRedacted).toBe("***@example.com");
  });
});
