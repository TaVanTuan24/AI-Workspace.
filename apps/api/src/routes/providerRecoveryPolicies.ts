import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth/requirePermission.js";
import { attachLocalUser } from "../middleware/auth.js";
import {
  createProviderRecoveryPolicy,
  deleteProviderRecoveryPolicy,
  getProviderRecoveryPolicyRun,
  listProviderRecoveryPolicies,
  listProviderRecoveryPolicyRuns,
  previewProviderRecoveryPolicies,
  setProviderRecoveryPolicyEnabled,
  updateProviderRecoveryPolicy
} from "../services/providerRecoveryPolicyService.js";
import {
  expireOverrides,
  getRecoveryOverride,
  listRecoveryOverrides,
  rollbackOverride
} from "../services/providerRecoveryOverrideService.js";
import { env } from "../config/env.js";
import {
  PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
  getSchedulerStatus
} from "../services/schedulerStatusService.js";

const actionSchema = z.object({
  type: z.string(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional()
});

const policyInputSchema = z.object({
  name: z.string(),
  enabled: z.boolean().optional(),
  triggerTypes: z.array(z.string()),
  providers: z.array(z.string()).optional(),
  severities: z.array(z.string()).optional(),
  statuses: z.array(z.string()).optional(),
  actions: z.array(actionSchema),
  cooldownMinutes: z.number().optional()
});

const policyPatchSchema = policyInputSchema.partial();

const previewSchema = z.object({
  triggerType: z.string(),
  provider: z.string().optional(),
  severity: z.string().optional(),
  status: z.string().optional()
});

const rollbackSchema = z.object({
  resolution: z.enum(["manual_rollback", "fixed", "incorrect_policy"])
});

export async function providerRecoveryPolicyRoutes(app: FastifyInstance) {
  app.addHook("preHandler", attachLocalUser);

  app.get("/settings/provider-recovery/scheduler-status", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.read"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const status = await getSchedulerStatus(PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME).catch(() => null);
    return reply.send({
      data: {
        name: PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
        enabled: env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED,
        intervalSeconds: env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_INTERVAL_SECONDS,
        maxPerRun: env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_MAX_PER_RUN,
        lockTtlSeconds: env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_LOCK_TTL_SECONDS,
        lastStartedAt: status?.lastStartedAt,
        lastFinishedAt: status?.lastFinishedAt,
        lastStatus: status?.lastStatus ?? (env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED ? undefined : "disabled"),
        lastError: status?.lastError,
        lastLockAcquired: status?.lastLockAcquired,
        lastSummary: status?.lastSummary,
        runCount: status?.runCount ?? 0,
        failureCount: status?.failureCount ?? 0,
        skippedCount: status?.skippedCount ?? 0
      }
    });
  });

  app.get("/settings/provider-recovery/policies", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.read"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const policies = await listProviderRecoveryPolicies(request.user.id);
    return reply.send({ data: policies });
  });

  app.post("/settings/provider-recovery/policies", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.write"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const parsed = policyInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", details: parsed.error.errors });

    try {
      const policy = await createProviderRecoveryPolicy(request.user.id, parsed.data);
      return reply.code(201).send({ data: policy });
    } catch (error: any) {
      return reply.code(400).send({ error: error.message || "Invalid recovery policy" });
    }
  });

  app.patch("/settings/provider-recovery/policies/:id", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.write"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = request.params as { id: string };
    const parsed = policyPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", details: parsed.error.errors });

    try {
      const policy = await updateProviderRecoveryPolicy(request.user.id, id, parsed.data);
      return reply.send({ data: policy });
    } catch (error: any) {
      if (error.message === "Policy not found") return reply.code(404).send({ error: error.message });
      return reply.code(400).send({ error: error.message || "Invalid recovery policy" });
    }
  });

  app.post("/settings/provider-recovery/policies/:id/enable", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.write"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = request.params as { id: string };
    try {
      const policy = await setProviderRecoveryPolicyEnabled(request.user.id, id, true);
      return reply.send({ data: policy });
    } catch (error: any) {
      if (error.message === "Policy not found") return reply.code(404).send({ error: error.message });
      return reply.code(400).send({ error: error.message || "Failed to enable policy" });
    }
  });

  app.post("/settings/provider-recovery/policies/:id/disable", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.write"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = request.params as { id: string };
    try {
      const policy = await setProviderRecoveryPolicyEnabled(request.user.id, id, false);
      return reply.send({ data: policy });
    } catch (error: any) {
      if (error.message === "Policy not found") return reply.code(404).send({ error: error.message });
      return reply.code(400).send({ error: error.message || "Failed to disable policy" });
    }
  });

  app.delete("/settings/provider-recovery/policies/:id", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.write"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = request.params as { id: string };
    try {
      await deleteProviderRecoveryPolicy(request.user.id, id);
      return reply.send({ success: true });
    } catch (error: any) {
      if (error.message === "Policy not found") return reply.code(404).send({ error: error.message });
      return reply.code(400).send({ error: error.message || "Failed to delete policy" });
    }
  });

  app.get("/settings/provider-recovery/policy-runs", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.read"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const schema = z.object({
      policyId: z.string().optional(),
      status: z.string().optional(),
      limit: z.coerce.number().min(1).max(100).optional()
    });
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", details: parsed.error.errors });

    const runs = await listProviderRecoveryPolicyRuns({
      userId: request.user.id,
      policyId: parsed.data.policyId,
      status: parsed.data.status,
      limit: parsed.data.limit
    });
    return reply.send({ data: runs });
  });

  app.get("/settings/provider-recovery/policy-runs/:id", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.read"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = request.params as { id: string };
    const run = await getProviderRecoveryPolicyRun(request.user.id, id);
    if (!run) return reply.code(404).send({ error: "Policy run not found" });
    return reply.send({ data: run });
  });

  app.get("/settings/provider-recovery/overrides", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.read"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const schema = z.object({
      status: z.enum(["active", "expired", "rolled_back", "superseded", "failed", "all"]).optional(),
      provider: z.string().optional(),
      actionType: z.string().optional(),
      limit: z.coerce.number().min(1).max(200).optional()
    });
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", details: parsed.error.errors });

    try {
      const overrides = await listRecoveryOverrides({
        userId: request.user.id,
        ...parsed.data
      });
      return reply.send({ data: overrides });
    } catch (error: any) {
      return reply.code(400).send({ error: error.message || "Invalid override query" });
    }
  });

  app.get("/settings/provider-recovery/overrides/:id", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.read"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = request.params as { id: string };
    const override = await getRecoveryOverride(request.user.id, id);
    if (!override) return reply.code(404).send({ error: "Recovery override not found" });
    return reply.send({ data: override });
  });

  app.post("/settings/provider-recovery/overrides/:id/rollback", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.write"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = request.params as { id: string };
    const parsed = rollbackSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", details: parsed.error.errors });

    try {
      const override = await rollbackOverride({
        userId: request.user.id,
        overrideId: id,
        resolution: parsed.data.resolution
      });
      if (!override) return reply.code(404).send({ error: "Recovery override not found" });
      return reply.send({ data: override });
    } catch (error: any) {
      return reply.code(400).send({ error: error.message || "Failed to roll back override" });
    }
  });

  app.post("/settings/provider-recovery/overrides/expire", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.write"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const schema = z.object({
      dryRun: z.boolean().optional(),
      limit: z.number().min(1).max(200).optional()
    });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", details: parsed.error.errors });

    const result = await expireOverrides({
      userId: request.user.id,
      dryRun: parsed.data.dryRun,
      limit: parsed.data.limit
    });
    return reply.send({ data: result });
  });

  app.post("/settings/provider-recovery/policies/preview", async (request, reply) => {
    if (!(await requirePermission(request, reply, "providerRecovery.write"))) return;
    if (!request.user?.id) return reply.code(401).send({ error: "Unauthorized" });
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", details: parsed.error.errors });

    try {
      const preview = await previewProviderRecoveryPolicies({
        userId: request.user.id,
        ...parsed.data
      });
      return reply.send({ data: preview });
    } catch (error: any) {
      return reply.code(400).send({ error: error.message || "Invalid preview input" });
    }
  });
}
