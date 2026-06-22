import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { providerDiagnosticsHistoryService } from "../providerDiagnosticsHistoryService.js";
import { makeTestRunId, withTestUserScope } from "../../test/testIsolation.js";
import { prisma } from "../../services/prisma.js";
import { ProviderUiDiagnosis } from "@uaiw/shared";

describe("providerDiagnosticsHistoryService", () => {
  const testRunId = makeTestRunId("diagnosticsHistory");
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

  it("should truncate long summaries and redact sensible data", async () => {
    const longReason = "a".repeat(1000);
    
    const rawResult: ProviderUiDiagnosis = {
      provider: "chatgpt",
      status: "error",
      checkedAt: new Date().toISOString(),
      candidates: [
        {
          kind: "composer",
          selector: "textarea#prompt",
          confidence: 0.9,
          reason: "Found composer",
          visible: true,
          role: "textbox containing test@email.com",
          dataTestId: "this-is-ok",
        }
      ],
      missingKinds: ["send_button"],
      warnings: [longReason],
    };

    const result = await providerDiagnosticsHistoryService.recordDiagnosticsRun({
      userId: testUser.id,
      provider: "chatgpt",
      startedAt: new Date(),
      completedAt: new Date(),
      result: rawResult,
      source: "test",
    });

    expect(result.status).toBe("error");
    expect(result.reason?.length).toBeLessThanOrEqual(503); // "..." appended
    
    const selectorHints = JSON.parse(result.selectorHintsJson!);
    expect(selectorHints[0].role).toContain("[redacted-email]");
    
    const stats = JSON.parse(result.redactionStatsJson!);
    expect(stats.redactionsPerformed).toBeGreaterThan(0);
  });

  it("should omit forbidden keys like session, token, cookie", async () => {
    const rawResult: any = {
      provider: "gemini",
      status: "ok",
      checkedAt: new Date().toISOString(),
      candidates: [],
      missingKinds: [
        {
          kind: "test",
          cookie: "secret",
          token: "secret",
          session: { jwt: "test" },
          nested: {
            authorization: "bearer foo",
            storageState: "bar"
          }
        }
      ],
      warnings: [],
    };

    const result = await providerDiagnosticsHistoryService.recordDiagnosticsRun({
      userId: testUser.id,
      provider: "gemini",
      startedAt: new Date(),
      completedAt: new Date(),
      result: rawResult,
      source: "test",
    });

    const missing = JSON.parse(result.missingCapabilitiesJson!);
    
    expect(missing[0].cookie).toBeUndefined();
    expect(missing[0].token).toBeUndefined();
    expect(missing[0].session).toBeUndefined();
    expect(missing[0].nested.authorization).toBeUndefined();
    expect(missing[0].nested.storageState).toBeUndefined();

    const stats = JSON.parse(result.redactionStatsJson!);
    expect(stats.redactionsPerformed).toBeGreaterThanOrEqual(4);
  });

  it("should diff two diagnostics runs correctly", async () => {
    const run1 = await providerDiagnosticsHistoryService.recordDiagnosticsRun({
      userId: testUser.id,
      provider: "chatgpt",
      startedAt: new Date(),
      completedAt: new Date(),
      result: {
        provider: "chatgpt",
        status: "ok",
        checkedAt: new Date().toISOString(),
        candidates: [{ kind: "composer", selector: "textarea", confidence: 1, reason: "", visible: true }],
        missingKinds: [],
        warnings: [],
      },
      source: "test",
    });

    const run2 = await providerDiagnosticsHistoryService.recordDiagnosticsRun({
      userId: testUser.id,
      provider: "chatgpt",
      startedAt: new Date(),
      completedAt: new Date(),
      result: {
        provider: "chatgpt",
        status: "ui_changed",
        checkedAt: new Date().toISOString(),
        candidates: [{ kind: "model_picker", selector: "select", confidence: 1, reason: "", visible: true }],
        missingKinds: ["composer"],
        warnings: [],
      },
      source: "test",
    });

    const diff = await providerDiagnosticsHistoryService.diffDiagnosticsRuns({
      userId: testUser.id,
      leftRunId: run1.id,
      rightRunId: run2.id,
    });

    expect(diff).not.toBeNull();
    expect(diff?.changedStatus).toBe(true);
    expect(diff?.addedDetectedCapabilities).toContain("model_picker");
    expect(diff?.removedDetectedCapabilities).toContain("composer");
    expect(diff?.addedMissingCapabilities).toContain("composer");
  });
});
