import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { providerDiagnosticsDriftAlertService } from "../providerDiagnosticsDriftAlertService.js";
import { providerDiagnosticsBaselineService } from "../providerDiagnosticsBaselineService.js";
import { providerDiagnosticsHistoryService } from "../providerDiagnosticsHistoryService.js";
import { makeTestRunId, withTestUserScope } from "../../test/testIsolation.js";
import { prisma } from "../prisma.js";

describe("providerDiagnosticsDriftAlertService", () => {
  const testRunId = makeTestRunId("diagnosticsDriftAlerts");
  let userId: string;
  let testUser: any;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const scope = await withTestUserScope(testRunId);
    userId = scope.userId;
    cleanup = scope.cleanup;
    testUser = await prisma.user.create({
      data: {
        id: userId,
        email: scope.email
      }
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should create a drift alert and resolve it if a new run restores baseline", async () => {
    const runLeft = await providerDiagnosticsHistoryService.recordDiagnosticsRun({
      userId,
      provider: "chatgpt",
      startedAt: new Date(),
      result: {
        provider: "chatgpt",
        status: "ok",
        candidates: [
          { kind: "composer", selector: "textarea", confidence: 1, reason: "", visible: true },
        ],
        missingKinds: [],
        warnings: [],
      },
      source: "test"
    });

    await providerDiagnosticsBaselineService.createBaselineFromRun({
      userId,
      runId: runLeft.id,
      name: "Baseline",
      setActive: true
    });

    const runDrifted = await providerDiagnosticsHistoryService.recordDiagnosticsRun({
      userId,
      provider: "chatgpt",
      startedAt: new Date(),
      result: {
        provider: "chatgpt",
        status: "ok",
        candidates: [],
        missingKinds: ["composer"],
        warnings: [],
      },
      source: "test"
    });

    await providerDiagnosticsDriftAlertService.evaluateAfterDiagnosticsRun({ userId, runId: runDrifted.id });

    const alerts = await providerDiagnosticsDriftAlertService.listDriftAlerts({ userId });
    expect(alerts.length).toBe(1);
    expect(alerts[0].status).toBe("open");
    expect(alerts[0].severity).toBe("error");

    const runRestored = await providerDiagnosticsHistoryService.recordDiagnosticsRun({
      userId,
      provider: "chatgpt",
      startedAt: new Date(),
      result: {
        provider: "chatgpt",
        status: "ok",
        candidates: [
          { kind: "composer", selector: "textarea", confidence: 1, reason: "", visible: true },
        ],
        missingKinds: [],
        warnings: [],
      },
      source: "test"
    });

    await providerDiagnosticsDriftAlertService.evaluateAfterDiagnosticsRun({ userId, runId: runRestored.id });

    const updatedAlerts = await providerDiagnosticsDriftAlertService.listDriftAlerts({ userId, status: "resolved" });
    expect(updatedAlerts.length).toBe(1);
    expect(updatedAlerts[0].id).toBe(alerts[0].id);
    expect(updatedAlerts[0].summary).toContain("Auto-resolved");
  });

  it("should support manual resolution of alerts", async () => {
    const alert = await prisma.providerDiagnosticsDriftAlert.create({
      data: {
        userId,
        provider: "chatgpt",
        diagnosticsRunId: "dummy_run",
        severity: "warning",
        status: "open",
        driftScore: 50,
        summary: "Dummy alert"
      }
    });

    const resolved = await providerDiagnosticsDriftAlertService.resolveAlert({
      userId,
      alertId: alert.id,
      resolution: "accepted_change",
      note: "UI changed, expected"
    });

    expect(resolved.status).toBe("resolved");
    expect(resolved.metadata.resolution).toBe("accepted_change");
    expect(resolved.metadata.resolutionNote).toBe("UI changed, expected");
  });

});
