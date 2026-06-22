import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { providerDiagnosticsBaselineService } from "../providerDiagnosticsBaselineService.js";
import { providerDiagnosticsHistoryService } from "../providerDiagnosticsHistoryService.js";
import { makeTestRunId, withTestUserScope } from "../../test/testIsolation.js";
import { prisma } from "../prisma.js";

describe("providerDiagnosticsBaselineService", () => {
  const testRunId = makeTestRunId("diagnosticsBaselines");
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

  it("should create an active baseline from an existing diagnostics run", async () => {
    const run = await providerDiagnosticsHistoryService.recordDiagnosticsRun({
      userId,
      provider: "chatgpt",
      startedAt: new Date(),
      result: {
        provider: "chatgpt",
        status: "ok",
        candidates: [{ kind: "composer", selector: "textarea", confidence: 1, reason: "", visible: true }],
        missingKinds: [],
        warnings: [],
      },
      source: "test"
    });

    const baseline = await providerDiagnosticsBaselineService.createBaselineFromRun({
      userId,
      runId: run.id,
      name: "Test Baseline",
      setActive: true
    });

    expect(baseline).not.toBeNull();
    expect(baseline.name).toBe("Test Baseline");
    expect(baseline.isActive).toBe(true);
    expect(baseline.sourceRunId).toBe(run.id);

    // Verify it deactivates older active baselines
    const run2 = await providerDiagnosticsHistoryService.recordDiagnosticsRun({
      userId,
      provider: "chatgpt",
      startedAt: new Date(),
      result: {
        provider: "chatgpt",
        status: "ok",
        candidates: [{ kind: "composer", selector: "textarea", confidence: 1, reason: "", visible: true }],
        missingKinds: [],
        warnings: [],
      },
      source: "test"
    });

    const baseline2 = await providerDiagnosticsBaselineService.createBaselineFromRun({
      userId,
      runId: run2.id,
      name: "Test Baseline 2",
      setActive: true
    });

    expect(baseline2.isActive).toBe(true);

    const oldBaseline = await prisma.providerDiagnosticsBaseline.findUnique({ where: { id: baseline.id } });
    expect(oldBaseline?.isActive).toBe(false);
  });

  it("should evaluate drift correctly and compute scores", async () => {
    const runLeft = await providerDiagnosticsHistoryService.recordDiagnosticsRun({
      userId,
      provider: "chatgpt",
      startedAt: new Date(),
      result: {
        provider: "chatgpt",
        status: "ok",
        candidates: [
          { kind: "composer", selector: "textarea", confidence: 1, reason: "", visible: true },
          { kind: "send_button", selector: "button", confidence: 1, reason: "", visible: true }
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

    const runRight = await providerDiagnosticsHistoryService.recordDiagnosticsRun({
      userId,
      provider: "chatgpt",
      startedAt: new Date(),
      result: {
        provider: "chatgpt",
        status: "ok",
        candidates: [
          { kind: "composer", selector: "textarea", confidence: 1, reason: "", visible: true },
        ],
        missingKinds: ["send_button"],
        warnings: [],
      },
      source: "test"
    });

    const evaluation = await providerDiagnosticsBaselineService.evaluateDrift({
      userId,
      runId: runRight.id
    });

    expect(evaluation.shouldAlert).toBe(true);
    // Removed detected capability (send_button) -> 25 points
    // Removed detected capability (send_button) -> 25 points
    // Added missing capability (send_button) -> 30 points
    // Removed selector hint (send_button) -> 10 points
    // Score should be 65 (error)
    expect(evaluation.driftScore).toBe(65);
    expect(evaluation.severity).toBe("error");
    expect(evaluation.removedDetectedCapabilities).toContain("send_button");
    expect(evaluation.addedMissingCapabilities).toContain("send_button");
  });
});
