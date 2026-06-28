import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth/requirePermission.js";
import { attachLocalUser } from "../middleware/auth.js";
import { 
  listProviderHealthIncidents, 
  getProviderHealthIncident, 
  resolveIncident 
} from "../services/providerHealthIncidentService.js";
import { refreshProviderHealth, runUiDiagnostics } from "../services/providerHealthService.js";
import { providerDiagnosticsHistoryService } from "../services/providerDiagnosticsHistoryService.js";
import { providerDiagnosticsBaselineService } from "../services/providerDiagnosticsBaselineService.js";
import { providerDiagnosticsDriftAlertService } from "../services/providerDiagnosticsDriftAlertService.js";
import type { ProviderId } from "@uaiw/shared/types/provider.js";

export async function providerHealthIncidentsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/provider-health/incidents", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.read"))) return;
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    try {
      const schema = z.object({
        provider: z.string().optional(),
        status: z.enum(["open", "resolved", "all"]).optional(),
        severity: z.string().optional(),
        limit: z.coerce.number().min(1).max(100).optional()
      });

      const query = schema.parse(request.query);

      const incidents = await listProviderHealthIncidents(request.user.id, {
        provider: query.provider,
        status: query.status,
        severity: query.severity,
        limit: query.limit
      });

      const dtos = incidents.map(inc => ({
        id: inc.id,
        provider: inc.provider,
        connectionId: inc.connectionId,
        status: inc.status,
        previousStatus: inc.previousStatus,
        severity: inc.severity,
        reason: inc.reason,
        startedAt: inc.startedAt.toISOString(),
        lastSeenAt: inc.lastSeenAt.toISOString(),
        resolvedAt: inc.resolvedAt?.toISOString(),
        occurrenceCount: inc.occurrenceCount,
        notificationEventId: inc.notificationEventId,
        metadata: inc.metadata ? JSON.parse(inc.metadata) : undefined
      }));

      return reply.send({ data: dtos });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: "Validation failed", details: err.errors });
      }
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.get("/settings/provider-health/incidents/:id", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.read"))) return;
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    try {
      const { id } = request.params as { id: string };
      const incident = await getProviderHealthIncident(request.user.id, id);
      
      if (!incident) {
        return reply.code(404).send({ error: "Incident not found" });
      }

      const dto = {
        id: incident.id,
        provider: incident.provider,
        connectionId: incident.connectionId,
        status: incident.status,
        previousStatus: incident.previousStatus,
        severity: incident.severity,
        reason: incident.reason,
        startedAt: incident.startedAt.toISOString(),
        lastSeenAt: incident.lastSeenAt.toISOString(),
        resolvedAt: incident.resolvedAt?.toISOString(),
        occurrenceCount: incident.occurrenceCount,
        notificationEventId: incident.notificationEventId,
        metadata: incident.metadata ? JSON.parse(incident.metadata) : undefined
      };

      return reply.send(dto);
    } catch (err) {
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.post("/settings/provider-health/incidents/:id/resolve", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.action"))) return;
    if (!request.user || !request.user.id) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    try {
      const { id } = request.params as { id: string };
      const schema = z.object({
        resolution: z.enum(["fixed_externally", "ignored", "no_longer_relevant"]),
        note: z.string().max(500).optional()
      });

      const body = schema.parse(request.body);

      const updated = await resolveIncident(
        request.user.id,
        id,
        body.resolution,
        body.note
      );

      return reply.send({ success: true, resolvedAt: updated.resolvedAt?.toISOString() });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: "Validation failed", details: err.errors });
      } else if (err.message === "Incident not found") {
        return reply.code(404).send({ error: err.message });
      }
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.post("/settings/provider-health/incidents/:id/actions/health-check", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.action"))) return;
    if (!request.user || !request.user.id) return reply.code(401).send({ error: "Unauthorized" });
    try {
      const { id } = request.params as { id: string };
      const incident = await getProviderHealthIncident(request.user.id, id);
      if (!incident) return reply.code(404).send({ error: "Incident not found" });
      const result = await refreshProviderHealth(request.user.id, incident.provider as ProviderId);
      return reply.send({ data: result });
    } catch (err: any) {
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.post("/settings/provider-health/incidents/:id/actions/ui-diagnostics", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.action"))) return;
    if (!request.user || !request.user.id) return reply.code(401).send({ error: "Unauthorized" });
    try {
      const { id } = request.params as { id: string };
      const incident = await getProviderHealthIncident(request.user.id, id);
      if (!incident) return reply.code(404).send({ error: "Incident not found" });
      
      const startedAt = new Date();
      let result = null;
      let errorReason = undefined;
      
      try {
        result = await runUiDiagnostics(request.user.id, incident.provider as ProviderId);
      } catch (err: any) {
        errorReason = err.message;
      }
      
      const runRecord = await providerDiagnosticsHistoryService.recordDiagnosticsRun({
        userId: request.user.id,
        provider: incident.provider,
        connectionId: incident.connectionId || undefined,
        incidentId: incident.id,
        startedAt,
        completedAt: new Date(),
        result,
        source: "runbook_action",
        errorReason
      });

      let driftEvaluation = undefined;
      try {
        const alert = await providerDiagnosticsDriftAlertService.evaluateAfterDiagnosticsRun({ userId: request.user.id, runId: runRecord.id });
        if (alert) {
          driftEvaluation = {
            severity: alert.severity,
            driftScore: alert.driftScore,
            summary: alert.summary,
            alertId: alert.id
          };
        }
      } catch (err) {
        // ignore drift evaluation errors to not fail the main diagnostic action
      }

      if (errorReason) {
        return reply.code(500).send({ error: "UI Diagnostics failed", reason: errorReason, diagnosticsRunId: runRecord.id, driftEvaluation });
      }

      return reply.send({ data: result, diagnosticsRunId: runRecord.id, driftEvaluation });
    } catch (err: any) {
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.get("/settings/provider-health/diagnostics-runs", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.read"))) return;
    if (!request.user || !request.user.id) return reply.code(401).send({ error: "Unauthorized" });
    try {
      const schema = z.object({
        provider: z.string().optional(),
        incidentId: z.string().optional(),
        status: z.string().optional(),
        limit: z.coerce.number().min(1).max(100).optional()
      });
      const query = schema.parse(request.query);
      const runs = await providerDiagnosticsHistoryService.listDiagnosticsRuns({
        userId: request.user.id,
        provider: query.provider,
        incidentId: query.incidentId,
        status: query.status,
        limit: query.limit
      });
      return reply.send({ data: runs });
    } catch (err: any) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: "Validation failed", details: err.errors });
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.get("/settings/provider-health/diagnostics-runs/:id", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.read"))) return;
    if (!request.user || !request.user.id) return reply.code(401).send({ error: "Unauthorized" });
    try {
      const { id } = request.params as { id: string };
      const run = await providerDiagnosticsHistoryService.getDiagnosticsRunDetail({ userId: request.user.id, runId: id });
      if (!run) return reply.code(404).send({ error: "Diagnostics run not found" });
      return reply.send({ data: run });
    } catch (err: any) {
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.get("/settings/provider-health/diagnostics-runs/:id/diff/:otherId", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.read"))) return;
    if (!request.user || !request.user.id) return reply.code(401).send({ error: "Unauthorized" });
    try {
      const { id, otherId } = request.params as { id: string; otherId: string };
      const diff = await providerDiagnosticsHistoryService.diffDiagnosticsRuns({
        userId: request.user.id,
        leftRunId: id,
        rightRunId: otherId
      });
      if (!diff) return reply.code(404).send({ error: "One or both diagnostics runs not found" });
      return reply.send({ data: diff });
    } catch (err: any) {
      if (err.message.includes("different providers")) {
        return reply.code(400).send({ error: err.message });
      }
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // Baselines

  app.get("/settings/provider-health/diagnostics-baselines", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.read"))) return;
    if (!request.user || !request.user.id) return reply.code(401).send({ error: "Unauthorized" });
    try {
      const schema = z.object({
        provider: z.string().optional(),
        isActive: z.enum(["true", "false"]).optional(),
        limit: z.coerce.number().min(1).max(100).optional()
      });
      const query = schema.parse(request.query);
      const baselines = await providerDiagnosticsBaselineService.listBaselines({
        userId: request.user.id,
        provider: query.provider,
        isActive: query.isActive === "true" ? true : query.isActive === "false" ? false : undefined,
        limit: query.limit
      });
      return reply.send({ data: baselines });
    } catch (err: any) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: "Validation failed", details: err.errors });
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.post("/settings/provider-health/diagnostics-runs/:id/set-baseline", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.action"))) return;
    if (!request.user || !request.user.id) return reply.code(401).send({ error: "Unauthorized" });
    try {
      const { id } = request.params as { id: string };
      const schema = z.object({
        name: z.string().min(1).max(100),
        setActive: z.boolean().default(true)
      });
      const body = schema.parse(request.body);
      const baseline = await providerDiagnosticsBaselineService.createBaselineFromRun({
        userId: request.user.id,
        runId: id,
        name: body.name,
        setActive: body.setActive
      });
      return reply.send({ data: baseline });
    } catch (err: any) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: "Validation failed", details: err.errors });
      if (err.message === "Diagnostics run not found") return reply.code(404).send({ error: err.message });
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.post("/settings/provider-health/diagnostics-baselines/:id/deactivate", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.action"))) return;
    if (!request.user || !request.user.id) return reply.code(401).send({ error: "Unauthorized" });
    try {
      const { id } = request.params as { id: string };
      const baseline = await providerDiagnosticsBaselineService.deactivateBaseline({
        userId: request.user.id,
        baselineId: id
      });
      return reply.send({ data: baseline });
    } catch (err: any) {
      if (err.message === "Baseline not found") return reply.code(404).send({ error: err.message });
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.post("/settings/provider-health/diagnostics-runs/:id/evaluate-drift", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.action"))) return;
    if (!request.user || !request.user.id) return reply.code(401).send({ error: "Unauthorized" });
    try {
      const { id } = request.params as { id: string };
      const schema = z.object({ persist: z.boolean().default(false) });
      const body = schema.parse(request.body || {});

      let evaluation = await providerDiagnosticsBaselineService.evaluateDrift({
        userId: request.user.id,
        runId: id
      });

      if (body.persist) {
        await providerDiagnosticsDriftAlertService.evaluateAfterDiagnosticsRun({ userId: request.user.id, runId: id });
      }

      return reply.send({ data: evaluation });
    } catch (err: any) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: "Validation failed", details: err.errors });
      if (err.message === "Run not found") return reply.code(404).send({ error: err.message });
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // Drift Alerts

  app.get("/settings/provider-health/diagnostics-drift-alerts", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.read"))) return;
    if (!request.user || !request.user.id) return reply.code(401).send({ error: "Unauthorized" });
    try {
      const schema = z.object({
        provider: z.string().optional(),
        status: z.enum(["open", "resolved", "all"]).optional(),
        severity: z.enum(["info", "warning", "error"]).optional(),
        limit: z.coerce.number().min(1).max(100).optional()
      });
      const query = schema.parse(request.query);
      const alerts = await providerDiagnosticsDriftAlertService.listDriftAlerts({
        userId: request.user.id,
        provider: query.provider,
        status: query.status,
        severity: query.severity,
        limit: query.limit
      });
      return reply.send({ data: alerts });
    } catch (err: any) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: "Validation failed", details: err.errors });
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.get("/settings/provider-health/diagnostics-drift-alerts/:id", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.read"))) return;
    if (!request.user || !request.user.id) return reply.code(401).send({ error: "Unauthorized" });
    try {
      const { id } = request.params as { id: string };
      const alert = await providerDiagnosticsDriftAlertService.getDriftAlertDetail({
        userId: request.user.id,
        alertId: id
      });
      if (!alert) return reply.code(404).send({ error: "Alert not found" });
      return reply.send({ data: alert });
    } catch (err: any) {
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.post("/settings/provider-health/diagnostics-drift-alerts/:id/resolve", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerDiagnostics.action"))) return;
    if (!request.user || !request.user.id) return reply.code(401).send({ error: "Unauthorized" });
    try {
      const { id } = request.params as { id: string };
      const schema = z.object({
        resolution: z.enum(["accepted_change", "fixed", "ignored"]),
        note: z.string().max(500).optional()
      });
      const body = schema.parse(request.body);
      
      const resolved = await providerDiagnosticsDriftAlertService.resolveAlert({
        userId: request.user.id,
        alertId: id,
        resolution: body.resolution,
        note: body.note
      });
      return reply.send({ data: resolved });
    } catch (err: any) {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: "Validation failed", details: err.errors });
      if (err.message === "Alert not found") return reply.code(404).send({ error: err.message });
      if (err.message === "Alert already resolved") return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: "Internal server error" });
    }
  });
}
