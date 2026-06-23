import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth/requirePermission.js";
import { WORKSPACE_ROLES } from "../auth/permissions.js";
import { attachLocalUser } from "../middleware/auth.js";
import {
  acceptWorkspaceInvite,
  createWorkspaceInvite,
  listWorkspaceInvites,
  revokeWorkspaceInvite,
  WorkspaceInviteError
} from "../services/workspaceInviteService.js";
import { prisma } from "../services/prisma.js";
import { env } from "../config/env.js";
import { deliverInviteEmail } from "../services/workspaceInviteDeliveryService.js";
import { renderInviteEmailPreview } from "../services/workspaceInviteTemplateService.js";
import { getWorkspaceInviteEmailDeliveryPreflight } from "../services/email/emailDeliveryPreflightService.js";
import { createEmailProvider } from "../services/email/emailProvider.js";

const inviteCreateBody = z.object({
  email: z.string().email(),
  role: z.enum(WORKSPACE_ROLES)
});

import { getSchedulerStatus, WORKSPACE_INVITE_EXPIRY_SCHEDULER_NAME } from "../services/schedulerStatusService.js";

const inviteParams = z.object({
  inviteId: z.string().min(1)
});

const previewBody = z.object({
  email: z.string().email(),
  role: z.enum(WORKSPACE_ROLES),
  expiresInDays: z.number().int().min(1).max(365).optional().default(7)
});

const acceptBody = z.object({
  token: z.string().min(1)
});

const deliveryTestBody = z.object({
  email: z.string().email().optional(),
  allowRealSendTest: z.boolean().optional()
});

export async function workspaceInviteRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/workspace/invites", async (request, reply) => {
    if (!(await requirePermission(request, reply, "users.read"))) return;
    try {
      const list = await prisma.workspaceInvite.findMany({
        where: { workspaceId: request.workspaceContext!.workspaceId },
        orderBy: { createdAt: "desc" },
        include: {
          deliveryAttempts: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              status: true,
              channel: true,
              reason: true,
              createdAt: true
            }
          }
        }
      });

      return reply.send({
        invites: list.map(invite => ({
          ...invite,
          tokenHash: undefined, // ensure hash is scrubbed
          latestDelivery: invite.deliveryAttempts[0] || null
        }))
      });
    } catch (error) {
      return sendInviteError(reply, error);
    }
  });

  app.get("/settings/workspace/invites/scheduler-status", async (request, reply) => {
    if (!(await requirePermission(request, reply, "users.manageRoles"))) return;

    try {
      const status = await getSchedulerStatus(WORKSPACE_INVITE_EXPIRY_SCHEDULER_NAME);
      if (!status) {
        return reply.send({
          name: WORKSPACE_INVITE_EXPIRY_SCHEDULER_NAME,
          enabled: false,
          runCount: 0,
          failureCount: 0,
          skippedCount: 0
        });
      }
      return reply.send(status);
    } catch (error) {
      return reply.code(500).send({ error: "internal_server_error" });
    }
  });

  app.get("/settings/workspace/invites/email-delivery-status", async (request, reply) => {
    if (!(await requirePermission(request, reply, "users.read"))) return;
    try {
      const preflight = getWorkspaceInviteEmailDeliveryPreflight(env);
      return reply.send(preflight);
    } catch (error) {
      return sendInviteError(reply, error);
    }
  });

  app.get("/settings/workspace/invites/:inviteId/delivery-attempts", async (request, reply) => {
    if (!(await requirePermission(request, reply, "users.manageRoles"))) return;
    try {
      const { inviteId } = inviteParams.parse(request.params);
      const attempts = await prisma.workspaceInviteDeliveryAttempt.findMany({
        where: {
          workspaceId: request.workspaceContext!.workspaceId,
          inviteId
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          channel: true,
          status: true,
          recipientEmailRedacted: true,
          reason: true,
          createdAt: true
        }
      });
      return reply.send({ attempts });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: "invalid_input" });
      return sendInviteError(reply, error);
    }
  });

  app.post("/settings/workspace/invites/email-delivery-test", async (request, reply) => {
    if (!(await requirePermission(request, reply, "users.manageRoles"))) return;
    try {
      const body = deliveryTestBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_input" });

      const emailToUse = body.data.email || request.user?.email;
      if (!emailToUse) {
        return reply.code(400).send({ error: "invalid_email" });
      }

      const preflight = getWorkspaceInviteEmailDeliveryPreflight(env);
      const provider = createEmailProvider(env);

      const testSubject = "Unified AI Workspace email delivery test";
      const testText = "This is a test email from Unified AI Workspace. It contains no invite tokens.";
      const testHtml = "<p>This is a test email from Unified AI Workspace. It contains no invite tokens.</p>";

      // We only send if allowRealSendTest is explicitly true and preflight allows it
      if (body.data.allowRealSendTest && preflight.realSendPossible) {
        const result = await provider.send({
          to: emailToUse,
          subject: testSubject,
          text: testText,
          html: testHtml
        });
        return reply.send({
          status: result.status,
          provider: result.provider,
          error: result.error
        });
      }

      // Default behavior: dry-run or preflight preview
      return reply.send({
        status: "skipped_test_mode",
        provider: preflight.provider,
        testSubject,
        testText
      });
    } catch (error) {
      return sendInviteError(reply, error);
    }
  });

  app.post("/settings/workspace/invites", async (request, reply) => {
    if (!(await requirePermission(request, reply, "users.manageRoles"))) return;
    try {
      const body = inviteCreateBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_input" });

      const result = await createWorkspaceInvite({
        workspaceId: request.workspaceContext!.workspaceId,
        email: body.data.email,
        role: body.data.role,
        actorUserId: request.user.id
      });

      const inviteUrl = env.WORKSPACE_INVITE_BASE_URL
        ? `${env.WORKSPACE_INVITE_BASE_URL}/invites/accept?token=${result.rawToken}`
        : undefined;

      const workspace = await prisma.workspace.findUnique({ where: { id: request.workspaceContext!.workspaceId } });
      const actorUser = await prisma.user.findUnique({ where: { id: request.user.id } });

      const emailTemplate = renderInviteEmailPreview({
        workspaceName: workspace?.name || "Unified AI Workspace",
        inviterName: actorUser?.displayName || actorUser?.email || "A member",
        inviteeEmail: body.data.email,
        role: body.data.role,
        acceptUrl: inviteUrl,
        expiresAt: new Date(result.invite.expiresAt),
        deliveryEnabled: env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED
      });

      const delivery = await deliverInviteEmail({
        workspaceId: request.workspaceContext!.workspaceId,
        inviteId: result.invite.id,
        inviteeEmail: body.data.email,
        subject: emailTemplate.subject,
        text: emailTemplate.text,
        html: emailTemplate.html
      });

      return reply.send({
        invite: result.invite,
        token: result.rawToken,
        inviteUrl,
        emailPreview: emailTemplate,
        delivery: {
          channel: delivery.channel,
          status: delivery.status
        }
      });
    } catch (error) {
      return sendInviteError(reply, error);
    }
  });

  app.post("/settings/workspace/invites/preview", async (request, reply) => {
    if (!(await requirePermission(request, reply, "users.manageRoles"))) return;
    try {
      const body = previewBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_input" });

      const expiresAt = new Date(Date.now() + body.data.expiresInDays * 24 * 60 * 60 * 1000);
      
      const workspace = await prisma.workspace.findUnique({ where: { id: request.workspaceContext!.workspaceId } });
      const actorUser = await prisma.user.findUnique({ where: { id: request.user.id } });

      const emailPreview = renderInviteEmailPreview({
        workspaceName: workspace?.name || "Unified AI Workspace",
        inviterName: actorUser?.displayName || actorUser?.email || "A member",
        inviteeEmail: body.data.email,
        role: body.data.role,
        acceptUrl: "[invite link shown after creation]",
        expiresAt,
        deliveryEnabled: env.WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED
      });

      return reply.send({ emailPreview });
    } catch (error) {
      return sendInviteError(reply, error);
    }
  });

  app.post("/settings/workspace/invites/:inviteId/revoke", async (request, reply) => {
    if (!(await requirePermission(request, reply, "users.manageRoles"))) return;
    try {
      const { inviteId } = inviteParams.parse(request.params);
      const invite = await revokeWorkspaceInvite({
        workspaceId: request.workspaceContext!.workspaceId,
        inviteId
      });
      return reply.send({ invite });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: "invalid_input" });
      return sendInviteError(reply, error);
    }
  });

  app.post("/workspace/invites/accept", async (request, reply) => {
    // Requires authenticated user, but no specific workspace role required
    if (!request.user?.id) return reply.code(401).send({ error: "unauthorized" });
    try {
      const body = acceptBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_input" });

      const result = await acceptWorkspaceInvite({
        token: body.data.token,
        userId: request.user.id
      });
      return reply.send(result);
    } catch (error) {
      return sendInviteError(reply, error);
    }
  });
}

function sendInviteError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof WorkspaceInviteError)) throw error;

  if (error.code === "invite_not_found") return reply.code(404).send({ error: "invite_not_found" });
  if (error.code === "invite_expired") return reply.code(400).send({ error: "invite_expired" });
  if (error.code === "invite_already_accepted") return reply.code(400).send({ error: "invite_already_accepted" });
  if (error.code === "invite_revoked") return reply.code(400).send({ error: "invite_revoked" });
  if (error.code === "invalid_role") return reply.code(400).send({ error: "invalid_role" });
  if (error.code === "already_member") return reply.code(409).send({ error: "already_member" });
  if (error.code === "already_invited") return reply.code(409).send({ error: "already_invited" });
  if (error.code === "email_mismatch") return reply.code(403).send({ error: "email_mismatch" });

  return reply.code(400).send({ error: "invalid_request" });
}
