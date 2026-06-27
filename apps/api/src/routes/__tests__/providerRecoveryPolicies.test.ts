import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import { prisma } from "../../services/prisma.js";
import { providerRecoveryPolicyRoutes } from "../providerRecoveryPolicies.js";
import { makeTestRunId, cleanupTestUserData } from "../../test/testIsolation.js";
import { createWorkspaceTestContext, buildAuthHeaders, type WorkspaceTestContext } from "../../test/workspaceTestContext.js";
import {
  PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
  recordSchedulerFailed,
  recordSchedulerFinished
} from "../../services/schedulerStatusService.js";

vi.mock("../../middleware/auth.js", () => ({
  attachLocalUser: async (request: any) => {
    request.user = { id: request.headers["x-local-user-id"] || "test-user-id", email: "test@example.com" };
  }
}));

describe("providerRecoveryPolicyRoutes", () => {
  const testRunId = makeTestRunId("providerRecoveryRoutes");
  let app: any;
  let context: WorkspaceTestContext;
  let otherContext: WorkspaceTestContext;
  let userId: string;
  let otherUserId: string;

  beforeEach(async () => {
    context = await createWorkspaceTestContext(testRunId);
    otherContext = await createWorkspaceTestContext(`${testRunId}-other`);
    userId = context.userId;
    otherUserId = otherContext.userId;

    app = Fastify();
    app.decorateRequest("user", null);
    await app.register(providerRecoveryPolicyRoutes);
  });

  afterEach(async () => {
    await app.close();
    await cleanupTestUserData(userId);
    await cleanupTestUserData(otherUserId);
  });

  it("creates, lists, updates, disables, enables, and deletes a policy", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/settings/provider-recovery/policies",
      headers: { "x-local-user-id": userId },
      payload: {
        name: "Notify incident",
        enabled: true,
        triggerTypes: ["provider_incident_opened"],
        providers: ["chatgpt"],
        severities: ["warning"],
        statuses: ["requires_login"],
        actions: [{ type: "notify_in_app", enabled: true }],
        cooldownMinutes: 30
      }
    });
    expect(create.statusCode).toBe(201);
    const policy = create.json().data;

    const list = await app.inject({
      method: "GET",
      url: "/settings/provider-recovery/policies",
      headers: { "x-local-user-id": userId }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);

    const patch = await app.inject({
      method: "PATCH",
      url: `/settings/provider-recovery/policies/${policy.id}`,
      headers: { "x-local-user-id": userId },
      payload: { name: "Notify updated", cooldownMinutes: 120 }
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.name).toBe("Notify updated");

    const disable = await app.inject({
      method: "POST",
      url: `/settings/provider-recovery/policies/${policy.id}/disable`,
      headers: { "x-local-user-id": userId }
    });
    expect(disable.statusCode).toBe(200);
    expect(disable.json().data.enabled).toBe(false);

    const enable = await app.inject({
      method: "POST",
      url: `/settings/provider-recovery/policies/${policy.id}/enable`,
      headers: { "x-local-user-id": userId }
    });
    expect(enable.statusCode).toBe(200);
    expect(enable.json().data.enabled).toBe(true);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/settings/provider-recovery/policies/${policy.id}`,
      headers: { "x-local-user-id": userId }
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().success).toBe(true);
  });

  it("rejects forbidden actions", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/settings/provider-recovery/policies",
      headers: { "x-local-user-id": userId },
      payload: {
        name: "Unsafe",
        triggerTypes: ["provider_incident_opened"],
        actions: [{ type: "dump_dom", enabled: true }]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Forbidden recovery action");
  });

  it("previews matching policies without creating a run", async () => {
    await prisma.providerRecoveryPolicy.create({
      data: {
        userId,
        workspaceId: context.workspaceId,
        name: "Preview",
        triggerTypes: JSON.stringify(["diagnostics_drift_alert_opened"]),
        providers: JSON.stringify(["gemini"]),
        severities: JSON.stringify([]),
        statuses: JSON.stringify([]),
        actions: JSON.stringify([{ type: "notify_in_app", enabled: true }]),
        cooldownMinutes: 60
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/settings/provider-recovery/policies/preview",
      headers: { "x-local-user-id": userId },
      payload: {
        triggerType: "diagnostics_drift_alert_opened",
        provider: "gemini",
        severity: "warning",
        status: "open"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.matchedPolicies).toHaveLength(1);
    await expect(prisma.providerRecoveryPolicyRun.count({ where: { userId } })).resolves.toBe(0);
  });

  it("denies cross-user policy mutations and run reads", async () => {
    const policy = await prisma.providerRecoveryPolicy.create({
      data: {
        userId: otherUserId,
        workspaceId: otherContext.workspaceId,
        name: "Other",
        triggerTypes: JSON.stringify(["provider_incident_opened"]),
        actions: JSON.stringify([{ type: "notify_in_app", enabled: true }]),
        cooldownMinutes: 60
      }
    });
    const run = await prisma.providerRecoveryPolicyRun.create({
      data: {
        userId: otherUserId,
        policyId: policy.id,
        triggerType: "provider_incident_opened",
        status: "success",
        actionsAttempted: JSON.stringify(["notify_in_app"]),
        actionsSucceeded: JSON.stringify(["notify_in_app"]),
        actionsFailed: JSON.stringify([])
      }
    });

    const patch = await app.inject({
      method: "PATCH",
      url: `/settings/provider-recovery/policies/${policy.id}`,
      headers: { "x-local-user-id": userId },
      payload: { name: "Should fail" }
    });
    expect(patch.statusCode).toBe(404);

    const getRun = await app.inject({
      method: "GET",
      url: `/settings/provider-recovery/policy-runs/${run.id}`,
      headers: { "x-local-user-id": userId }
    });
    expect(getRun.statusCode).toBe(404);
  });

  it("lists, rolls back, and expires owned recovery overrides", async () => {
    const active = await prisma.providerRecoveryOverride.create({
      data: {
        userId,
        workspaceId: context.workspaceId,
        actionType: "disable_model_temporarily",
        provider: "chatgpt",
        modelId: "chatgpt-web",
        status: "active",
        overrideState: JSON.stringify({ modelId: "chatgpt-web" }),
        previousState: JSON.stringify({ type: "virtual_override" }),
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000)
      }
    });
    const expired = await prisma.providerRecoveryOverride.create({
      data: {
        userId,
        workspaceId: context.workspaceId,
        actionType: "mark_provider_temporarily_degraded",
        provider: "gemini",
        status: "active",
        overrideState: JSON.stringify({ mode: "avoid_if_possible" }),
        previousState: JSON.stringify({ type: "virtual_override" }),
        startsAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 60_000)
      }
    });

    const list = await app.inject({
      method: "GET",
      url: "/settings/provider-recovery/overrides?status=active",
      headers: { "x-local-user-id": userId }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((item: any) => item.id)).toEqual(expect.arrayContaining([active.id, expired.id]));

    const rollback = await app.inject({
      method: "POST",
      url: `/settings/provider-recovery/overrides/${active.id}/rollback`,
      headers: { "x-local-user-id": userId },
      payload: { resolution: "manual_rollback" }
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().data.status).toBe("rolled_back");

    const expire = await app.inject({
      method: "POST",
      url: "/settings/provider-recovery/overrides/expire",
      headers: { "x-local-user-id": userId },
      payload: {}
    });
    expect(expire.statusCode).toBe(200);
    expect(expire.json().data.expired).toBe(1);
    expect(expire.json().data.expiredOverrides.map((item: any) => item.id)).toContain(expired.id);
  });

  it("returns safe provider recovery scheduler status", async () => {
    await recordSchedulerFinished({
      name: PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
      enabled: true,
      lockAcquired: true,
      summary: {
        scanned: 4,
        expired: 2,
        skipped: 2,
        dryRun: false,
        durationMs: 99,
        lock: "acquired",
        source: "scheduler"
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/settings/provider-recovery/scheduler-status",
      headers: { "x-local-user-id": userId }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      name: "provider_recovery_override_expiry",
      intervalSeconds: expect.any(Number),
      maxPerRun: expect.any(Number),
      lockTtlSeconds: expect.any(Number),
      lastStatus: "success",
      lastSummary: {
        scanned: 4,
        expired: 2,
        skipped: 2,
        dryRun: false,
        durationMs: 99,
        lock: "acquired",
        source: "scheduler"
      },
      runCount: expect.any(Number),
      failureCount: expect.any(Number),
      skippedCount: expect.any(Number)
    });
    expect(JSON.stringify(response.json().data)).not.toContain("expiredOverrides");
  });

  it("returns sanitized scheduler errors only", async () => {
    await recordSchedulerFailed({
      name: PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME,
      enabled: true,
      lockAcquired: false,
      error: new Error("redis://:secret@localhost:6379 token=abc123456789012345678901234567890"),
      summary: { lock: "unavailable", source: "scheduler" }
    });

    const response = await app.inject({
      method: "GET",
      url: "/settings/provider-recovery/scheduler-status",
      headers: { "x-local-user-id": userId }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.lastStatus).toBe("failed");
    expect(response.json().data.lastError).toContain("redis://[redacted]");
    expect(response.json().data.lastError).toContain("token=[redacted]");
    expect(response.json().data.lastError).not.toContain("secret");
    expect(response.json().data.lastError).not.toContain("abc123456789012345678901234567890");
  });

  it("denies cross-user recovery override reads and rollback", async () => {
    const override = await prisma.providerRecoveryOverride.create({
      data: {
        userId: otherUserId,
        workspaceId: otherContext.workspaceId,
        actionType: "disable_model_temporarily",
        modelId: "claude-web",
        status: "active",
        overrideState: JSON.stringify({ modelId: "claude-web" }),
        previousState: JSON.stringify({ type: "virtual_override" }),
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000)
      }
    });

    const get = await app.inject({
      method: "GET",
      url: `/settings/provider-recovery/overrides/${override.id}`,
      headers: { "x-local-user-id": userId }
    });
    expect(get.statusCode).toBe(404);

    const rollback = await app.inject({
      method: "POST",
      url: `/settings/provider-recovery/overrides/${override.id}/rollback`,
      headers: { "x-local-user-id": userId },
      payload: { resolution: "manual_rollback" }
    });
    expect(rollback.statusCode).toBe(404);
  });
});
