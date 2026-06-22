import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderHealthScheduler } from "../providerHealthScheduler.js";
import { env } from "../../config/env.js";
import { chatQueueConnection } from "../chatQueue.js";
import { prisma } from "../prisma.js";
import * as providerHealthService from "../providerHealthService.js";
import { captureConsole, type ConsoleCapture } from "../../test/logCapture.js";

vi.mock("../../config/env.js", () => ({
  env: {
    PROVIDER_HEALTH_SCHEDULER_ENABLED: true,
    PROVIDER_HEALTH_SCHEDULER_INTERVAL_SECONDS: 900,
    PROVIDER_HEALTH_SCHEDULER_JITTER_SECONDS: 0,
    PROVIDER_HEALTH_SCHEDULER_LOCK_TTL_SECONDS: 840,
    PROVIDER_HEALTH_SCHEDULER_MAX_USERS_PER_RUN: 50
  }
}));

vi.mock("../chatQueue.js", () => ({
  chatQueueConnection: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn()
  }
}));

vi.mock("../prisma.js", () => ({
  prisma: {
    providerConnection: {
      findMany: vi.fn()
    }
  }
}));

vi.mock("../providerHealthService.js", () => ({
  refreshProviderHealth: vi.fn()
}));

describe("ProviderHealthScheduler", () => {
  let scheduler: ProviderHealthScheduler;
  let logCapture: ConsoleCapture;
  let errorCapture: ConsoleCapture;

  beforeEach(() => {
    vi.clearAllMocks();
    logCapture = captureConsole("log");
    errorCapture = captureConsole("error");
    scheduler = new ProviderHealthScheduler();
  });

  afterEach(() => {
    logCapture.restore();
    errorCapture.restore();
  });

  it("should not schedule if disabled", () => {
    env.PROVIDER_HEALTH_SCHEDULER_ENABLED = false;
    scheduler.start();
    // @ts-ignore
    expect(scheduler.isRunning).toBe(false);
    logCapture.expectOnly([/Provider health scheduler is disabled by config\./]);
    env.PROVIDER_HEALTH_SCHEDULER_ENABLED = true;
  });

  it("should skip runOnce if lock is not acquired", async () => {
    vi.mocked(chatQueueConnection.set).mockResolvedValueOnce(null);

    const result = await scheduler.runOnce("manual");
    expect(result.skipped).toBe(1);
    expect(result.checkedUsers).toBe(0);
    expect(chatQueueConnection.del).not.toHaveBeenCalled();
    logCapture.expectOnly([/Provider health scheduler: skipped, lock held by another instance\./]);
  });

  it("should acquire lock, process users, and release lock", async () => {
    vi.mocked(chatQueueConnection.set).mockResolvedValueOnce("OK");
    vi.mocked(chatQueueConnection.get).mockResolvedValueOnce(scheduler["instanceId"]);

    // First findMany for unique users
    vi.mocked(prisma.providerConnection.findMany).mockResolvedValueOnce([
      { userId: "user1" } as any,
      { userId: "user2" } as any
    ]);

    // Second findMany for user1 connections
    vi.mocked(prisma.providerConnection.findMany).mockResolvedValueOnce([
      { provider: "chatgpt" } as any
    ]);

    // Third findMany for user2 connections
    vi.mocked(prisma.providerConnection.findMany).mockResolvedValueOnce([
      { provider: "gemini" } as any
    ]);

    vi.mocked(providerHealthService.refreshProviderHealth).mockResolvedValueOnce({
      connectionStatus: "connected"
    } as any);

    vi.mocked(providerHealthService.refreshProviderHealth).mockResolvedValueOnce({
      connectionStatus: "requires_login"
    } as any);

    const result = await scheduler.runOnce("manual");

    expect(result.skipped).toBe(0);
    expect(result.checkedUsers).toBe(2);
    expect(result.checkedConnections).toBe(2);
    expect(result.healthy).toBe(1);
    expect(result.requiresLogin).toBe(1);
    expect(result.errors).toBe(0);

    expect(chatQueueConnection.del).toHaveBeenCalledWith("provider-health-scheduler:lock");
    logCapture.expectOnly([
      /Provider health scheduler run started \(reason: manual\)/,
      /Provider health scheduler run finished/
    ]);
  });

  it("should handle per-provider errors gracefully", async () => {
    vi.mocked(chatQueueConnection.set).mockResolvedValueOnce("OK");
    vi.mocked(chatQueueConnection.get).mockResolvedValueOnce(scheduler["instanceId"]);

    vi.mocked(prisma.providerConnection.findMany).mockResolvedValueOnce([
      { userId: "user1" } as any
    ]);

    vi.mocked(prisma.providerConnection.findMany).mockResolvedValueOnce([
      { provider: "chatgpt" } as any
    ]);

    vi.mocked(providerHealthService.refreshProviderHealth).mockRejectedValueOnce(new Error("Refresh failed"));

    const result = await scheduler.runOnce("manual");

    expect(result.checkedUsers).toBe(1);
    expect(result.checkedConnections).toBe(1);
    expect(result.healthy).toBe(0);
    expect(result.requiresLogin).toBe(0);
    expect(result.errors).toBe(1);

    expect(chatQueueConnection.del).toHaveBeenCalled();
    logCapture.expectOnly([
      /Provider health scheduler run started \(reason: manual\)/,
      /Provider health scheduler run finished/
    ]);
    errorCapture.expectOnly([/Provider health refresh failed for connection userId=user1 provider=chatgpt Error: Refresh failed/]);
  });
});
