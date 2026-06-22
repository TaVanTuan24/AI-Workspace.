import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateStatus,
  exitCodeForReport,
  responsePreview,
  safeJsonReport,
  type SmokeReport,
  writeReportFile
} from "./report.js";

describe("report helpers", () => {
  it("aggregates fail before warn before pass", () => {
    expect(aggregateStatus([{ name: "a", status: "pass" }])).toBe("pass");
    expect(aggregateStatus([{ name: "a", status: "warn" }])).toBe("warn");
    expect(aggregateStatus([{ name: "a", status: "warn" }, { name: "b", status: "fail" }])).toBe("fail");
  });

  it("truncates response previews to 300 chars", () => {
    const preview = responsePreview("x".repeat(400), true);
    expect(preview?.length).toBe(300);
  });

  it("omits response preview unless explicitly requested", () => {
    expect(responsePreview("hello", false)).toBeUndefined();
  });

  it("serializes safe JSON report", () => {
    const report: SmokeReport = {
      provider: "gemini",
      mode: "validate-session",
      status: "pass",
      startedAt: new Date(0).toISOString(),
      durationMs: 1,
      checks: [{ name: "provider_registered", status: "pass" }],
      reportVersion: 1,
      safe: true
    };
    expect(safeJsonReport(report)).toContain("provider_registered");
    expect(safeJsonReport(report)).not.toContain("cookie");
  });

  it("writes a safe report file and creates directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-smoke-"));
    const reportFile = join(root, "nested", "report.json");
    const report: SmokeReport = {
      provider: "gemini",
      mode: "detect-ui",
      status: "warn",
      startedAt: new Date(0).toISOString(),
      durationMs: 3,
      checks: [{ name: "response_container_found", status: "warn" }],
      reportVersion: 1,
      safe: true
    };

    await writeReportFile(report, reportFile);
    const raw = await readFile(reportFile, "utf8");
    const parsed = JSON.parse(raw) as SmokeReport;
    expect(parsed.safe).toBe(true);
    expect(parsed.reportVersion).toBe(1);
    await rm(root, { recursive: true, force: true });
  });

  it("does not include explicit secret fields in normal reports", () => {
    const report: SmokeReport = {
      provider: "gemini",
      mode: "validate-session",
      status: "pass",
      startedAt: new Date(0).toISOString(),
      durationMs: 1,
      checks: [{ name: "provider_registered", status: "pass" }],
      reportVersion: 1,
      safe: true
    };
    const json = safeJsonReport(report);
    for (const field of [
      "cookie",
      "token",
      "localStorage",
      "sessionStorage",
      "storageState",
      "ciphertext",
      "authTag",
      "iv",
      "password"
    ]) {
      expect(json).not.toContain(`"${field}"`);
    }
  });

  it("computes exit codes with fail-on-warn", () => {
    const base: SmokeReport = {
      provider: "gemini",
      mode: "detect-ui",
      status: "warn",
      startedAt: new Date(0).toISOString(),
      durationMs: 1,
      checks: [{ name: "response_container_found", status: "warn" }],
      reportVersion: 1,
      safe: true
    };

    expect(exitCodeForReport({ ...base, status: "pass" }, false)).toBe(0);
    expect(exitCodeForReport(base, false)).toBe(0);
    expect(exitCodeForReport(base, true)).toBe(1);
    expect(exitCodeForReport({ ...base, status: "fail" }, false)).toBe(1);
  });
});
