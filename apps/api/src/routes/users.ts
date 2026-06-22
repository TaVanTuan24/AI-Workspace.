import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth/requirePermission.js";
import { WORKSPACE_ROLES } from "../auth/permissions.js";
import { attachLocalUser } from "../middleware/auth.js";
import {
  listWorkspaceAuditEvents,
  listUsers,
  updateUserRole,
  UserManagementError
} from "../services/userManagementService.js";
import { disableMembership, enableMembership, WorkspaceMembershipError } from "../services/workspaceMembershipService.js";
import { prisma } from "../services/prisma.js";

const roleUpdateBody = z.object({
  role: z.enum(WORKSPACE_ROLES),
  confirmSelfDemotion: z.boolean().optional()
});

const userParams = z.object({
  userId: z.string().min(1)
});

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional()
});

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/users", async (request, reply) => {
    if (!(await requirePermission(request, reply, "users.read"))) return;
    try {
      const users = await listUsers({ workspaceId: request.workspaceContext!.workspaceId });
      return reply.send({ users });
    } catch (error) {
      return sendUserManagementError(reply, error);
    }
  });

  app.get("/settings/workspace/audit", async (request, reply) => {
    if (!(await requirePermission(request, reply, "users.read"))) return;
    try {
      const query = auditQuery.parse(request.query);
      const events = await listWorkspaceAuditEvents({
        workspaceId: request.workspaceContext!.workspaceId,
        limit: query.limit
      });
      return reply.send({ events });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: "invalid_query" });
      return sendUserManagementError(reply, error);
    }
  });

  app.patch("/settings/users/:userId/role", async (request, reply) => {
    if (!(await requirePermission(request, reply, "users.manageRoles"))) return;
    try {
      const { userId } = userParams.parse(request.params);
      const body = roleUpdateBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_role" });

      const user = await updateUserRole({
        workspaceId: request.workspaceContext!.workspaceId,
        actorUserId: request.user.id,
        targetUserId: userId,
        role: body.data.role,
        confirmSelfDemotion: body.data.confirmSelfDemotion
      });
      return reply.send({ user });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: "invalid_role" });
      return sendUserManagementError(reply, error);
    }
  });

  app.patch("/settings/users/:userId/membership", async (request, reply) => {
    if (!(await requirePermission(request, reply, "users.manageRoles"))) return;
    try {
      const { userId } = userParams.parse(request.params);
      const body = z.object({ status: z.enum(["active", "disabled"]) }).safeParse(request.body);
      
      if (!body.success) return reply.code(400).send({ error: "invalid_status" });

      const workspaceId = request.workspaceContext!.workspaceId;
      const membership = await prisma.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } }
      });

      if (!membership) return reply.code(404).send({ error: "user_not_found" });

      if (body.data.status === "disabled") {
        await disableMembership({
          actorUserId: request.user.id,
          workspaceId,
          membershipId: membership.id
        });
      } else {
        await enableMembership({
          actorUserId: request.user.id,
          workspaceId,
          membershipId: membership.id
        });
      }

      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: "invalid_status" });
      if (error instanceof WorkspaceMembershipError) {
        if (error.code === "permission_denied") return reply.code(403).send({ error: "permission_denied" });
        if (error.code === "last_owner_required") return reply.code(409).send({ error: "last_owner_required" });
        return reply.code(400).send({ error: error.code });
      }
      return reply.code(500).send({ error: "internal_server_error" });
    }
  });
}

function sendUserManagementError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof UserManagementError)) throw error;

  if (error.code === "permission_denied") return reply.code(403).send({ error: "permission_denied" });
  if (error.code === "invalid_role") return reply.code(400).send({ error: "invalid_role" });
  if (error.code === "user_not_found") return reply.code(404).send({ error: "user_not_found" });
  if (error.code === "last_owner_required") return reply.code(409).send({ error: "last_owner_required" });
  if (error.code === "self_demote_confirmation_required") {
    return reply.code(409).send({ error: "self_demote_confirmation_required" });
  }

  return reply.code(400).send({ error: "invalid_request" });
}
