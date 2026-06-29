import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { storageRoutes } from "../storage.js";
import { getStorageStats } from "../../services/storageStatsService.js";
import { runRetentionCleanup } from "../../services/retentionCleanupService.js";
import { getSchedulerFleetStatus } from "../../services/schedulerFleetStatusService.js";

vi.mock("../../middleware/auth.js", () => ({
  attachLocalUser: async (request: any) => {
    request.user = { id: "test-user-id", email: "test@example.com", role: "owner" };
  }
}));

vi.mock("../../services/storageStatsService.js", () => ({ getStorageStats: vi.fn() }));
vi.mock("../../services/retentionCleanupService.js", () => ({ runRetentionCleanup: vi.fn() }));
vi.mock("../../services/schedulerFleetStatusService.js", () => ({ getSchedulerFleetStatus: vi.fn() }));

const buildApp = () => {
  const app = Fastify();
  app.decorateRequest("user", null);
  app.register(storageRoutes);
  return app;
};

describe("storage routes", () => {
  const app = buildApp();

  it("returns storage stats", async () => {
    const stats = { entries: [], totalBytes: 0, computedAt: "2026-06-28T00:00:00.000Z" };
    vi.mocked(getStorageStats).mockResolvedValueOnce(stats as any);
    const response = await app.inject({ method: "GET", url: "/settings/storage" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(stats);
  });

  it("returns scheduler fleet status", async () => {
    const fleet = { schedulers: [{ name: "retention_cleanup", enabled: false, runCount: 0, failureCount: 0, skippedCount: 0 }] };
    vi.mocked(getSchedulerFleetStatus).mockResolvedValueOnce(fleet as any);
    const response = await app.inject({ method: "GET", url: "/settings/schedulers" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(fleet);
  });

  it("runs retention cleanup on demand", async () => {
    const result = {
      startedAt: "2026-06-28T00:00:00.000Z",
      finishedAt: "2026-06-28T00:00:01.000Z",
      durationMs: 1000,
      dryRun: false,
      usage: { matched: 5, deleted: 5 },
      notifications: { matched: 2, deleted: 2 }
    };
    vi.mocked(runRetentionCleanup).mockResolvedValueOnce(result as any);
    const response = await app.inject({
      method: "POST",
      url: "/settings/storage/retention/run",
      payload: { dryRun: false }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(runRetentionCleanup).toHaveBeenCalledWith({ dryRun: false });
  });

  it("passes dryRun through and defaults to false on empty body", async () => {
    vi.mocked(runRetentionCleanup).mockResolvedValue({ dryRun: true } as any);
    await app.inject({ method: "POST", url: "/settings/storage/retention/run", payload: { dryRun: true } });
    expect(runRetentionCleanup).toHaveBeenCalledWith({ dryRun: true });

    await app.inject({ method: "POST", url: "/settings/storage/retention/run" });
    expect(runRetentionCleanup).toHaveBeenLastCalledWith({ dryRun: false });
  });
});
