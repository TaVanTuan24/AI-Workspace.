import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env.js";
import { chatQueueConnection } from "../chatQueue.js";
import { expireOverrides } from "../providerRecoveryOverrideService.js";
import { ProviderRecoveryOverrideExpiryScheduler } from "../providerRecoveryOverrideExpiryScheduler.js";
import * as schedulerStatusService from "../schedulerStatusService.js";

vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED: true,
    PROVIDER_RECOVERY_OVERRIDE_EXPIRY_INTERVAL_SECONDS: 300,
    PROVIDER_RECOVERY_OVERRIDE_EXPIRY_LOCK_TTL_SECONDS: 120,
    PROVIDER_RECOVERY_OVERRIDE_EXPIRY_MAX_PER_RUN: 500
  }
}));

vi.mock("../chatQueue.js", () => ({
  chatQueueConnection: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn()
  }
}));

vi.mock("../providerRecoveryOverrideService.js", () => ({
  expireOverrides: vi.fn()
}));

vi.mock("../schedulerStatusService.js", () => ({
  PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_NAME: "provider_recovery_override_expiry",
  recordSchedulerStarted: vi.fn().mockResolvedValue(undefined),
  recordSchedulerFinished: vi.fn().mockResolvedValue(undefined),
  recordSchedulerSkipped: vi.fn().mockResolvedValue(undefined),
  recordSchedulerFailed: vi.fn().mockResolvedValue(undefined)
}));

describe("ProviderRecoveryOverrideExpiryScheduler", () => {
  let scheduler: ProviderRecoveryOverrideExpiryScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    scheduler = new ProviderRecoveryOverrideExpiryScheduler();
    env.NODE_ENV = "test";
    env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED = true;
    vi.mocked(expireOverrides).mockResolvedValue({
      scanned: 2,
      expired: 1,
      skipped: 1,
      dryRun: false,
      expiredOverrides: []
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not schedule when disabled", () => {
    env.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED = false;
    scheduler.start();
    expect(scheduler["isRunning"]).toBe(false);
    expect(schedulerStatusService.recordSchedulerSkipped).toHaveBeenCalledWith(expect.objectContaining({
      status: "disabled",
      enabled: false
    }));
  });

  it("starts and stops by clearing the scheduled timer", async () => {
    scheduler.start();
    expect(scheduler["isRunning"]).toBe(true);
    expect(scheduler["timer"]).not.toBeNull();

    await scheduler.stop();
    expect(scheduler["isRunning"]).toBe(false);
    expect(scheduler["timer"]).toBeNull();
  });

  it("skips when the Redis lock is already held", async () => {
    vi.mocked(chatQueueConnection.set).mockResolvedValueOnce(null);

    const result = await scheduler.runOnce("manual");

    expect(result.skipped).toBe(1);
    expect(result.lockAcquired).toBe(false);
    expect(result.lockMode).toBe("skipped");
    expect(expireOverrides).not.toHaveBeenCalled();
    expect(chatQueueConnection.del).not.toHaveBeenCalled();
    expect(schedulerStatusService.recordSchedulerSkipped).toHaveBeenCalledWith(expect.objectContaining({
      reason: "lock_held",
      lockAcquired: false
    }));
  });

  it("acquires the Redis lock, expires overrides, and releases only its own lock", async () => {
    vi.mocked(chatQueueConnection.set).mockResolvedValueOnce("OK");
    vi.mocked(chatQueueConnection.get).mockResolvedValueOnce(scheduler["instanceId"]);

    const result = await scheduler.runOnce("manual");

    expect(expireOverrides).toHaveBeenCalledWith({
      now: expect.any(Date),
      limit: 500
    });
    expect(result.lockAcquired).toBe(true);
    expect(result.lockMode).toBe("redis");
    expect(result.scanned).toBe(2);
    expect(result.expired).toBe(1);
    expect(result.skipped).toBe(1);
    expect(chatQueueConnection.del).toHaveBeenCalledWith("provider-recovery-overrides:expiry-lock");
    expect(schedulerStatusService.recordSchedulerStarted).toHaveBeenCalledWith(expect.objectContaining({
      lockAcquired: true
    }));
    expect(schedulerStatusService.recordSchedulerFinished).toHaveBeenCalledWith(expect.objectContaining({
      lockAcquired: true,
      summary: expect.objectContaining({ scanned: 2, expired: 1, lock: "acquired" })
    }));
  });

  it("runs without distributed lock in non-production when Redis is unavailable", async () => {
    env.NODE_ENV = "development";
    vi.mocked(chatQueueConnection.set).mockRejectedValueOnce(new Error("redis unavailable"));

    const result = await scheduler.runOnce("manual");

    expect(result.lockMode).toBe("local_no_lock");
    expect(result.errors).toBe(0);
    expect(result.expired).toBe(1);
    expect(expireOverrides).toHaveBeenCalledTimes(1);
    expect(chatQueueConnection.del).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith("Provider recovery override expiry scheduler: Redis lock unavailable; running without distributed lock in local mode.");
    expect(schedulerStatusService.recordSchedulerFinished).toHaveBeenCalledWith(expect.objectContaining({
      lockAcquired: false,
      summary: expect.objectContaining({ lock: "unavailable" })
    }));
  });

  it("skips in production when Redis lock cannot be acquired safely", async () => {
    env.NODE_ENV = "production";
    vi.mocked(chatQueueConnection.set).mockRejectedValueOnce(new Error("redis unavailable"));

    const result = await scheduler.runOnce("manual");

    expect(result.errors).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.lockMode).toBe("skipped");
    expect(expireOverrides).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "Provider recovery override expiry scheduler: Redis lock unavailable; skipping production run.",
      expect.any(Error)
    );
    expect(schedulerStatusService.recordSchedulerFailed).toHaveBeenCalledWith(expect.objectContaining({
      lockAcquired: false,
      summary: expect.objectContaining({ lock: "unavailable" })
    }));
  });

  it("records failed status when expiry service fails", async () => {
    vi.mocked(chatQueueConnection.set).mockResolvedValueOnce("OK");
    vi.mocked(chatQueueConnection.get).mockResolvedValueOnce(scheduler["instanceId"]);
    vi.mocked(expireOverrides).mockRejectedValueOnce(new Error("expiry failed token=unsafe"));

    const result = await scheduler.runOnce("manual");

    expect(result.errors).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      "Provider recovery override expiry scheduler run failed",
      expect.any(Error)
    );
    expect(schedulerStatusService.recordSchedulerFailed).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.any(Error),
      summary: expect.objectContaining({ lock: "acquired" })
    }));
    expect(schedulerStatusService.recordSchedulerFinished).not.toHaveBeenCalled();
  });
});
