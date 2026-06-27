import { describe, it, expect } from "vitest";
import { buildRunbook } from "../providerRecoveryRunbookService.js";

describe("providerRecoveryRunbookService", () => {
  it("should build runbook for requires_login", () => {
    const runbook = buildRunbook({
      userId: "u1",
      provider: "chatgpt",
      status: "requires_login",
      severity: "warning",
      incidentId: "inc1"
    });

    expect(runbook.title).toBe("Provider requires login");
    expect(runbook.recommendedSteps).toHaveLength(4); // 3 steps + 1 resolve
    expect(runbook.actions.some(a => a.type === "start_reconnect")).toBe(true);
    expect(runbook.actions.some(a => a.type === "run_safe_health_check")).toBe(true);
    expect(runbook.actions.some(a => a.type === "run_safe_ui_diagnostics")).toBe(true);
    expect(runbook.actions.some(a => a.type === "mark_incident_resolved")).toBe(true);
  });

  it("should build runbook for manual_action", () => {
    const runbook = buildRunbook({
      userId: "u1",
      provider: "gemini",
      status: "manual_action",
      incidentId: "inc2"
    });

    expect(runbook.title).toBe("Manual action required");
    expect(runbook.recommendedSteps).toHaveLength(3);
    expect(runbook.actions.some(a => a.type === "open_connection_settings")).toBe(true);
    expect(runbook.actions.some(a => a.type === "run_safe_ui_diagnostics")).toBe(true);
  });

  it("should build runbook for ui_changed", () => {
    const runbook = buildRunbook({
      userId: "u1",
      provider: "claude",
      status: "ui_changed",
      incidentId: "inc3"
    });

    expect(runbook.title).toBe("Provider UI changed");
    expect(runbook.actions.some(a => a.type === "run_safe_ui_diagnostics")).toBe(true);
    expect(runbook.actions.some(a => a.type === "start_reconnect")).toBe(true);
  });

  it("should build runbook for error", () => {
    const runbook = buildRunbook({
      userId: "u1",
      provider: "chatgpt",
      status: "error"
    });

    expect(runbook.title).toBe("Provider error");
    expect(runbook.actions.some(a => a.type === "run_safe_health_check")).toBe(true);
    expect(runbook.actions.some(a => a.type === "open_provider_health")).toBe(true);
    // no resolve action if no incidentId
    expect(runbook.actions.some(a => a.type === "mark_incident_resolved")).toBe(false);
  });

  it("should build runbook for no_usable_models", () => {
    const runbook = buildRunbook({
      userId: "u1",
      provider: "chatgpt",
      status: "no_usable_models"
    });

    expect(runbook.title).toBe("No usable models");
    expect(runbook.actions.some(a => a.type === "open_model_settings")).toBe(true);
    expect(runbook.actions.some(a => a.type === "open_provider_health")).toBe(true);
    expect(runbook.actions.some(a => a.type === "open_connection_settings")).toBe(true);
  });

  it("should return safe generic runbook for unknown status", () => {
    const runbook = buildRunbook({
      userId: "u1",
      provider: "chatgpt",
      status: "bizarre_status"
    });

    expect(runbook.title).toBe("Unknown provider issue");
    expect(runbook.actions.some(a => a.type === "run_safe_health_check")).toBe(true);
    expect(runbook.actions.some(a => a.type === "open_provider_health")).toBe(true);
  });
});
