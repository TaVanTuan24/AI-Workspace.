import { describe, expect, it } from "vitest";
import {
  getSchedulerStatus,
  recordSchedulerFailed,
  recordSchedulerFinished,
  recordSchedulerSkipped,
  recordSchedulerStarted
} from "../schedulerStatusService.js";
import { makeTestRunId } from "../../test/testIsolation.js";

describe("schedulerStatusService", () => {
  it("records started and success summary with safe counts only", async () => {
    const name = `${makeTestRunId("scheduler-status")}-success`;

    await recordSchedulerStarted({ name, enabled: true, lockAcquired: true });
    await recordSchedulerFinished({
      name,
      enabled: true,
      lockAcquired: true,
      summary: {
        scanned: 10,
        expired: 3,
        skipped: 7,
        dryRun: false,
        durationMs: 123,
        lock: "acquired",
        source: "scheduler"
      } as any
    });

    const status = await getSchedulerStatus(name);
    expect(status?.lastStatus).toBe("success");
    expect(status?.lastLockAcquired).toBe(true);
    expect(status?.lastSummary).toEqual({
      scanned: 10,
      expired: 3,
      skipped: 7,
      dryRun: false,
      durationMs: 123,
      lock: "acquired",
      source: "scheduler"
    });
    expect(JSON.stringify(status?.lastSummary)).not.toContain("override");
    expect(status?.runCount).toBe(1);
  });

  it("records skipped status and counters", async () => {
    const name = `${makeTestRunId("scheduler-status")}-skipped`;

    await recordSchedulerSkipped({
      name,
      enabled: true,
      reason: "lock_held",
      lockAcquired: false,
      summary: { skipped: 1, lock: "skipped", source: "scheduler" }
    });

    const status = await getSchedulerStatus(name);
    expect(status?.lastStatus).toBe("skipped");
    expect(status?.lastError).toBe("lock_held");
    expect(status?.skippedCount).toBe(1);
  });

  it("records failure with sanitized error text", async () => {
    const name = `${makeTestRunId("scheduler-status")}-failed`;

    await recordSchedulerFailed({
      name,
      enabled: true,
      error: new Error("failed token=abc123456789012345678901234567890 password=hunter2 redis://:secret@localhost:6379"),
      lockAcquired: false,
      summary: { lock: "unavailable", source: "scheduler" }
    });

    const status = await getSchedulerStatus(name);
    expect(status?.lastStatus).toBe("failed");
    expect(status?.failureCount).toBe(1);
    expect(status?.lastError).toContain("token=[redacted]");
    expect(status?.lastError).toContain("password=[redacted]");
    expect(status?.lastError).toContain("redis://[redacted]");
    expect(status?.lastError).not.toContain("hunter2");
    expect(status?.lastError).not.toContain("abc123456789012345678901234567890");
  });
});
