import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth/requirePermission.js";
import { getWorkspaceContextForRequest } from "../auth/workspaceContext.js";
import { attachLocalUser } from "../middleware/auth.js";
import { getWorkspaceUsageSummary, updateWorkspaceQuota, getWorkspaceQuotaEvents } from "../services/workspaceQuotaService.js";
import { getSchedulerStatus } from "../services/schedulerStatusService.js";
import { WORKSPACE_QUOTA_ALERT_SCHEDULER_NAME } from "../services/workspaceQuotaAlertScheduler.js";
import { env } from "../config/env.js";
import { getWorkspaceQuotaReport, type QuotaReportRange } from "../services/workspaceQuotaReportService.js";
import { WORKSPACE_QUOTA_PRESETS, applyWorkspaceQuotaPreset } from "../services/workspaceQuotaPresetService.js";

export async function workspaceQuotaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/workspace/quota", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const summary = await getWorkspaceUsageSummary({ workspaceId: ctx.workspaceId });
    return reply.send(summary);
  });

  app.get("/settings/workspace/quota/alert-scheduler-status", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const status = await getSchedulerStatus(WORKSPACE_QUOTA_ALERT_SCHEDULER_NAME);

    return reply.send({
      enabled: env.WORKSPACE_QUOTA_ALERT_SCHEDULER_ENABLED,
      intervalSeconds: env.WORKSPACE_QUOTA_ALERT_INTERVAL_SECONDS,
      maxWorkspacesPerRun: env.WORKSPACE_QUOTA_ALERT_MAX_WORKSPACES_PER_RUN,
      lockTtlSeconds: env.WORKSPACE_QUOTA_ALERT_LOCK_TTL_SECONDS,
      lastStartedAt: status?.lastStartedAt,
      lastFinishedAt: status?.lastFinishedAt,
      lastStatus: status?.lastStatus,
      lastSummary: status?.lastSummary || null,
      runCount: status?.runCount || 0,
      failureCount: status?.failureCount || 0,
      skippedCount: status?.skippedCount || 0
    });
  });

  app.get("/settings/workspace/quota/events", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const querySchema = z.object({
      resource: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional()
    });

    const query = querySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "invalid_query" });
    }

    const events = await getWorkspaceQuotaEvents({
      workspaceId: ctx.workspaceId,
      resource: query.data.resource,
      limit: query.data.limit
    });

    return reply.send({ events });
  });

  app.patch("/settings/workspace/quota", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx || ctx.role !== "owner") {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const schema = z.object({
      maxMembers: z.number().int().min(1).nullable().optional(),
      maxInvites: z.number().int().min(0).nullable().optional(),
      maxApiKeys: z.number().int().min(0).nullable().optional(),
      maxProviderConnections: z.number().int().min(0).nullable().optional(),
      maxMonthlyApiRequests: z.number().int().min(0).nullable().optional(),
      maxMonthlyInviteEmails: z.number().int().min(0).nullable().optional(),
      maxDiagnosticsBaselines: z.number().int().min(0).nullable().optional(),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_quota_patch" });
    }

    const updated = await updateWorkspaceQuota({
      workspaceId: ctx.workspaceId,
      patch: body.data
    });

    return reply.send(updated);
  });

  app.get("/settings/workspace/quota/report", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const querySchema = z.object({
      range: z.enum(["24h", "7d", "30d", "90d"]).default("7d")
    });

    const query = querySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "invalid_query" });
    }

    const userId = request.headers["x-local-user-id"] as string;

    const report = await getWorkspaceQuotaReport({ actorUserId: userId, workspaceId: ctx.workspaceId, range: query.data.range });
    return reply.send(report);
  });

  app.get("/settings/workspace/quota/report/download", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const querySchema = z.object({
      range: z.enum(["24h", "7d", "30d", "90d"]).default("7d")
    });

    const query = querySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "invalid_query" });
    }

    const userId = request.headers["x-local-user-id"] as string;

    const report = await getWorkspaceQuotaReport({ actorUserId: userId, workspaceId: ctx.workspaceId, range: query.data.range });
    const filename = `workspace-quota-report-${report.workspace.slug || report.workspace.id}-${query.data.range}.json`;

    return reply
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .type("application/json")
      .send(report);
  });

  app.get(
    "/settings/workspace/quota/presets",
    async (request, reply) => {
      if (!(await requirePermission(request, reply, "settings.read"))) return;

      const ctx = await getWorkspaceContextForRequest(request);
      if (!ctx) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      return reply.send({ presets: WORKSPACE_QUOTA_PRESETS });
    }
  );

  app.post("/settings/workspace/quota/presets/apply", async (request, reply) => {
    if (!(await requirePermission(request, reply, "settings.read"))) return;

    const ctx = await getWorkspaceContextForRequest(request);
    if (!ctx || ctx.role !== "owner") {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const schema = z.object({
      preset: z.enum(["local", "starter", "team"]),
      confirmExceeded: z.boolean().optional()
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }

    const userId = request.headers["x-local-user-id"] as string;

    const result = await applyWorkspaceQuotaPreset({
      actorUserId: userId,
      workspaceId: ctx.workspaceId,
      presetId: body.data.preset,
      confirmExceeded: body.data.confirmExceeded
    });

    if (!result.success && result.warning === "quota_preset_would_exceed_usage") {
      return reply.status(400).send({
        error: "quota_preset_would_exceed_usage",
        message: "Applying this preset would lower limits below current usage.",
        exceededResources: result.exceededResources
      });
    }

    return reply.send({ success: true });
  });
}
