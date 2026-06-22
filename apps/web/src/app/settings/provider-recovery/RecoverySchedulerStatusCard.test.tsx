import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecoverySchedulerStatusCard } from "./RecoverySchedulerStatusCard";

describe("RecoverySchedulerStatusCard", () => {
  it("renders empty scheduler state", () => {
    render(<RecoverySchedulerStatusCard status={null} />);

    expect(screen.getByText("Expiry Scheduler")).toBeInTheDocument();
    expect(screen.getByText("No runs yet")).toBeInTheDocument();
    expect(screen.getAllByText("Never")).toHaveLength(2);
  });

  it("renders enabled status and last summary", () => {
    render(
      <RecoverySchedulerStatusCard
        status={{
          name: "provider_recovery_override_expiry",
          enabled: true,
          intervalSeconds: 300,
          maxPerRun: 500,
          lockTtlSeconds: 120,
          lastStatus: "success",
          lastStartedAt: "2026-06-22T00:00:00.000Z",
          lastFinishedAt: "2026-06-22T00:00:01.000Z",
          lastLockAcquired: true,
          lastSummary: {
            scanned: 10,
            expired: 3,
            skipped: 7,
            dryRun: false,
            durationMs: 123,
            lock: "acquired",
            source: "scheduler"
          },
          runCount: 1,
          failureCount: 0,
          skippedCount: 0
        }}
      />
    );

    expect(screen.getAllByText("Enabled")).toHaveLength(2);
    expect(screen.getByText("success")).toBeInTheDocument();
    expect(screen.getByText("300s")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("123ms")).toBeInTheDocument();
    expect(screen.getByText("acquired")).toBeInTheDocument();
  });

  it("renders sanitized error text", () => {
    render(
      <RecoverySchedulerStatusCard
        status={{
          name: "provider_recovery_override_expiry",
          enabled: true,
          intervalSeconds: 300,
          maxPerRun: 500,
          lockTtlSeconds: 120,
          lastStatus: "failed",
          lastError: "redis://[redacted] token=[redacted]",
          runCount: 1,
          failureCount: 1,
          skippedCount: 0
        }}
      />
    );

    expect(screen.getByText("Last sanitized error")).toBeInTheDocument();
    expect(screen.getByText("redis://[redacted] token=[redacted]")).toBeInTheDocument();
  });
});
