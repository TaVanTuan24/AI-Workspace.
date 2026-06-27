import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../prisma.js";
import { makeTestRunId, withTestUserScope } from "../../test/testIsolation.js";
import { recordHealthObservation } from "../providerHealthIncidentService.js";

vi.mock("../providerHealthService.js", () => ({
  getProviderHealth: vi.fn().mockResolvedValue([
    { provider: "chatgpt", isUsable: false, healthStatus: "error" },
    { provider: "gemini", isUsable: true, healthStatus: "healthy" },
    { provider: "claude", isUsable: true, healthStatus: "healthy" }
  ]),
  refreshProviderHealth: vi.fn().mockResolvedValue({ provider: "chatgpt", isUsable: false }),
  runUiDiagnostics: vi.fn().mockResolvedValue({
    provider: "chatgpt",
    status: "ok",
    checkedAt: "2026-06-22T00:00:00.000Z",
    candidates: [],
    missingKinds: [],
    warnings: []
  })
}));

vi.mock("../providerDiagnosticsHistoryService.js", () => ({
  providerDiagnosticsHistoryService: {
    recordDiagnosticsRun: vi.fn().mockResolvedValue({ id: "diagnostics_run" })
  }
}));

import { getProviderHealth, refreshProviderHealth, runUiDiagnostics } from "../providerHealthService.js";
import { providerDiagnosticsHistoryService } from "../providerDiagnosticsHistoryService.js";
import {
  createProviderRecoveryPolicy,
  evaluateProviderRecoveryPolicies,
  previewProviderRecoveryPolicies
} from "../providerRecoveryPolicyService.js";

describe("providerRecoveryPolicyService", () => {
  const testRunId = makeTestRunId("providerRecoveryPolicyService");
  let userId: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const scope = await withTestUserScope(testRunId);
    userId = scope.userId;
    cleanup = scope.cleanup;
    await prisma.user.create({ data: { id: userId, email: scope.email } });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("rejects forbidden actions", async () => {
    await expect(createProviderRecoveryPolicy(userId, {
      name: "Bad policy",
      triggerTypes: ["provider_incident_opened"],
      actions: [{ type: "auto_login", enabled: true }]
    })).rejects.toThrow(/Forbidden recovery action/);

    await expect(createProviderRecoveryPolicy(userId, {
      name: "Prompt policy",
      triggerTypes: ["provider_incident_opened"],
      actions: [{ type: "submit_prompt", enabled: true }]
    })).rejects.toThrow(/Forbidden recovery action/);
  });

  it("creates safe notification runs without prompt or session metadata", async () => {
    const policy = await createProviderRecoveryPolicy(userId, {
      name: "Notify on incident",
      triggerTypes: ["provider_incident_opened"],
      providers: ["chatgpt"],
      severities: ["warning"],
      statuses: ["requires_login"],
      actions: [{ type: "notify_in_app", enabled: true }],
      cooldownMinutes: 60
    });

    const runs = await evaluateProviderRecoveryPolicies({
      userId,
      triggerType: "provider_incident_opened",
      triggerRefId: "incident_123",
      provider: "chatgpt",
      severity: "warning",
      status: "requires_login",
      metadata: {
        source: "test",
        token: "should-not-store",
        storageState: "should-not-store"
      } as any
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ policyId: policy.id, status: "success" });

    const event = await prisma.notificationEvent.findFirst({ where: { userId, kind: "provider_recovery_policy" } });
    expect(event).toBeTruthy();
    const rawRun = await prisma.providerRecoveryPolicyRun.findUnique({ where: { id: runs[0].id } });
    const raw = JSON.stringify({ event, rawRun });
    for (const forbidden of ["should-not-store", "storageState", "cookie", "password", "rawApiKey"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("respects cooldown and records skipped runs", async () => {
    await createProviderRecoveryPolicy(userId, {
      name: "Cooldown",
      triggerTypes: ["provider_incident_opened"],
      actions: [{ type: "notify_in_app", enabled: true }],
      cooldownMinutes: 60
    });

    const first = await evaluateProviderRecoveryPolicies({ userId, triggerType: "provider_incident_opened" });
    const second = await evaluateProviderRecoveryPolicies({ userId, triggerType: "provider_incident_opened" });
    const policy = await prisma.providerRecoveryPolicy.findFirstOrThrow({ where: { userId } });

    expect(first[0].status).toBe("success");
    expect(second[0].status).toBe("skipped");
    expect(second[0].skippedReason).toContain("cooldown");
    expect(policy.triggerCount).toBe(1);
  });

  it("matches provider, severity, and status filters", async () => {
    await createProviderRecoveryPolicy(userId, {
      name: "Filtered",
      triggerTypes: ["provider_incident_opened"],
      providers: ["gemini"],
      severities: ["critical"],
      statuses: ["ui_changed"],
      actions: [{ type: "notify_in_app", enabled: true }]
    });

    await expect(evaluateProviderRecoveryPolicies({
      userId,
      triggerType: "provider_incident_opened",
      provider: "chatgpt",
      severity: "critical",
      status: "ui_changed"
    })).resolves.toEqual([]);

    const runs = await evaluateProviderRecoveryPolicies({
      userId,
      triggerType: "provider_incident_opened",
      provider: "gemini",
      severity: "critical",
      status: "ui_changed"
    });
    expect(runs).toHaveLength(1);
  });

  it("previews matching policies without executing actions", async () => {
    await createProviderRecoveryPolicy(userId, {
      name: "Preview only",
      triggerTypes: ["diagnostics_drift_alert_opened"],
      providers: ["chatgpt"],
      actions: [{ type: "notify_in_app", enabled: true }]
    });

    const preview = await previewProviderRecoveryPolicies({
      userId,
      triggerType: "diagnostics_drift_alert_opened",
      provider: "chatgpt"
    });

    expect(preview.matchedPolicies).toHaveLength(1);
    await expect(prisma.providerRecoveryPolicyRun.count({ where: { userId } })).resolves.toBe(0);
    await expect(prisma.notificationEvent.count({ where: { userId } })).resolves.toBe(0);
  });

  it("delegates safe health checks and safe UI diagnostics without prompt data", async () => {
    await createProviderRecoveryPolicy(userId, {
      name: "Safe checks",
      triggerTypes: ["diagnostics_drift_alert_opened"],
      providers: ["chatgpt"],
      actions: [
        { type: "run_safe_health_check", enabled: true },
        { type: "run_safe_ui_diagnostics", enabled: true }
      ]
    });

    const runs = await evaluateProviderRecoveryPolicies({
      userId,
      triggerType: "diagnostics_drift_alert_opened",
      provider: "chatgpt",
      severity: "warning",
      status: "open"
    });

    expect(runs[0].status).toBe("success");
    expect(refreshProviderHealth).toHaveBeenCalledWith(userId, "chatgpt");
    expect(runUiDiagnostics).toHaveBeenCalledWith(userId, "chatgpt");
    expect(providerDiagnosticsHistoryService.recordDiagnosticsRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        provider: "chatgpt",
        source: "provider_recovery_policy"
      })
    );
  });

  it("records action failures safely", async () => {
    vi.mocked(refreshProviderHealth).mockRejectedValueOnce(new Error("cookie token secret failure"));
    await createProviderRecoveryPolicy(userId, {
      name: "Failure",
      triggerTypes: ["provider_incident_opened"],
      providers: ["chatgpt"],
      actions: [{ type: "run_safe_health_check", enabled: true }]
    });

    const runs = await evaluateProviderRecoveryPolicies({
      userId,
      triggerType: "provider_incident_opened",
      provider: "chatgpt"
    });

    expect(runs[0].status).toBe("failed");
    const raw = JSON.stringify(await prisma.providerRecoveryPolicyRun.findUnique({ where: { id: runs[0].id } }));
    expect(raw).not.toContain("cookie");
    expect(raw).not.toContain("token");
    expect(raw).not.toContain("secret");
  });

  it("evaluates policies when an incident opens", async () => {
    await createProviderRecoveryPolicy(userId, {
      name: "Incident hook",
      triggerTypes: ["provider_incident_opened"],
      providers: ["chatgpt"],
      actions: [{ type: "notify_in_app", enabled: true }]
    });

    await recordHealthObservation(userId, {
      provider: "chatgpt",
      displayName: "ChatGPT",
      readiness: "ready",
      capabilities: ["send_message"],
      connectionStatus: "requires_login",
      healthStatus: "requires_login",
      requiresLogin: true,
      isUsable: false,
      errorCode: "SESSION_EXPIRED",
      errorMessage: "Safe message"
    } as any, { source: "test" });

    const run = await prisma.providerRecoveryPolicyRun.findFirst({ where: { userId } });
    expect(run?.triggerType).toBe("provider_incident_opened");
    expect(run?.status).toBe("success");
  });

  it("creates duration-bound provider degraded overrides", async () => {
    await createProviderRecoveryPolicy(userId, {
      name: "Mark degraded",
      triggerTypes: ["provider_incident_opened"],
      providers: ["chatgpt"],
      actions: [{
        type: "mark_provider_temporarily_degraded",
        enabled: true,
        config: { durationMinutes: 30, mode: "avoid_if_possible", reason: "Safe drift summary" }
      }]
    });

    const runs = await evaluateProviderRecoveryPolicies({
      userId,
      triggerType: "provider_incident_opened",
      provider: "chatgpt",
      severity: "warning",
      status: "open"
    });

    expect(runs[0].status).toBe("success");
    const override = await prisma.providerRecoveryOverride.findFirstOrThrow({ where: { userId } });
    expect(override.actionType).toBe("mark_provider_temporarily_degraded");
    expect(override.status).toBe("active");
    expect(override.provider).toBe("chatgpt");
    expect(override.overrideState).toContain("avoid_if_possible");
  });

  it("creates fallback and temporary model disable overrides with safe IDs", async () => {
    await createProviderRecoveryPolicy(userId, {
      name: "Fallback and disable",
      triggerTypes: ["provider_incident_opened"],
      providers: ["chatgpt"],
      actions: [
        {
          type: "prefer_fallback_provider",
          enabled: true,
          config: { durationMinutes: 60, onlyIfProvider: "chatgpt", fallbackProviderOrder: ["gemini", "claude"] }
        },
        {
          type: "disable_model_temporarily",
          enabled: true,
          config: { durationMinutes: 60, modelId: "chatgpt-web", reason: "UI drift detected" }
        }
      ]
    });

    const runs = await evaluateProviderRecoveryPolicies({
      userId,
      triggerType: "provider_incident_opened",
      provider: "chatgpt",
      severity: "error",
      status: "open"
    });

    expect(runs[0].status).toBe("success");
    expect(getProviderHealth).toHaveBeenCalled();
    const overrides = await prisma.providerRecoveryOverride.findMany({ where: { userId }, orderBy: { actionType: "asc" } });
    expect(overrides.map((override) => override.actionType).sort()).toEqual(["disable_model_temporarily", "prefer_fallback_provider"]);
    expect(JSON.stringify(overrides)).not.toContain("token");
    expect(JSON.stringify(overrides)).not.toContain("storageState");
  });

  it("skips fallback action safely when no usable fallback exists", async () => {
    vi.mocked(getProviderHealth).mockResolvedValueOnce([
      { provider: "chatgpt", isUsable: false, healthStatus: "error" },
      { provider: "gemini", isUsable: false, healthStatus: "requires_login" },
      { provider: "claude", isUsable: false, healthStatus: "requires_login" }
    ] as any);
    await createProviderRecoveryPolicy(userId, {
      name: "No fallback",
      triggerTypes: ["provider_incident_opened"],
      providers: ["chatgpt"],
      actions: [{
        type: "prefer_fallback_provider",
        enabled: true,
        config: { durationMinutes: 60, onlyIfProvider: "chatgpt", fallbackProviderOrder: ["gemini", "claude"] }
      }]
    });

    const runs = await evaluateProviderRecoveryPolicies({
      userId,
      triggerType: "provider_incident_opened",
      provider: "chatgpt"
    });

    expect(runs[0].status).toBe("failed");
    expect(runs[0].actionsFailed[0].reason).toContain("No usable fallback");
    await expect(prisma.providerRecoveryOverride.count({ where: { userId } })).resolves.toBe(0);
  });
});
