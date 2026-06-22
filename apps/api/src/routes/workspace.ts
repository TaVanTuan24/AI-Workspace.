import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth/requirePermission.js";
import { getWorkspaceContextForRequest } from "../auth/workspaceContext.js";
import { attachLocalUser } from "../middleware/auth.js";
import { getWorkspaceById, createWorkspaceForUser } from "../services/workspaceService.js";
import { getPermissionsForRole } from "../auth/permissions.js";
import { prisma } from "../services/prisma.js";

export async function workspaceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/workspace", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const workspace = await getWorkspaceById(ctx.workspaceId);
    if (!workspace) {
      return reply.code(404).send({ error: "Workspace not found" });
    }

    return reply.send({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      currentUser: {
        id: ctx.userId,
        role: ctx.role,
        permissions: ctx.permissions
      }
    });
  });

  app.get("/settings/workspaces", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const memberships = await prisma.workspaceMembership.findMany({
      where: { userId: request.user.id, status: "active" },
      include: { workspace: true }
    });

    const ctx = await getWorkspaceContextForRequest(request);

    return reply.send({
      currentWorkspaceId: ctx?.workspaceId || request.user.workspaceId,
      workspaces: memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        role: m.role,
        membershipId: m.id
      }))
    });
  });

  app.post("/settings/workspaces", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const schema = z.object({
      name: z.string().min(2).max(80)
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_workspace_name" });
    }

    try {
      const result = await createWorkspaceForUser({
        actorUserId: request.user.id,
        name: body.data.name
      });

      // Clear cached context to force re-resolution on next request
      request.workspaceContext = undefined;

      return reply.send(result);
    } catch (err: any) {
      if (err.message === "invalid_workspace_name") {
        return reply.code(400).send({ error: "invalid_workspace_name" });
      }
      request.log.error(err, "Failed to create workspace");
      return reply.code(500).send({ error: "workspace_creation_failed" });
    }
  });

  app.post("/settings/workspaces/switch", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const schema = z.object({
      workspaceId: z.string().min(1)
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_workspace" });
    }

    const { workspaceId } = body.data;

    const membership = await prisma.workspaceMembership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: request.user.id
        }
      }
    });

    if (!membership) {
      return reply.code(403).send({ error: "workspace_access_denied" });
    }

    if (membership.status === "disabled") {
      return reply.code(403).send({ error: "workspace_membership_disabled" });
    }

    if (membership.status !== "active") {
      return reply.code(403).send({ error: "workspace_access_denied" });
    }

    await prisma.user.update({
      where: { id: request.user.id },
      data: { workspaceId }
    });

    // Clear cached context to force re-resolution
    request.workspaceContext = undefined;
    const newCtx = await getWorkspaceContextForRequest(request);

    return reply.send({
      currentWorkspaceId: newCtx?.workspaceId,
      role: newCtx?.role,
      permissions: newCtx?.permissions
    });
  });
}
