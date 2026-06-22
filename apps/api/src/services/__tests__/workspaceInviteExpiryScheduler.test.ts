import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { workspaceInviteExpiryScheduler } from "../workspaceInviteExpiryScheduler.js";
import { prisma } from "../prisma.js";
import { WORKSPACE_INVITE_EXPIRY_SCHEDULER_NAME } from "../schedulerStatusService.js";
import { chatQueueConnection } from "../chatQueue.js";
import { env } from "../../config/env.js";

vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    WORKSPACE_INVITE_EXPIRY_SCHEDULER_ENABLED: true,
    WORKSPACE_INVITE_EXPIRY_INTERVAL_SECONDS: 3600,
    WORKSPACE_INVITE_EXPIRY_LOCK_TTL_SECONDS: 60,
    WORKSPACE_INVITE_EXPIRY_MAX_PER_RUN: 100
  }
}));

vi.mock("../chatQueue.js", () => ({
  chatQueueConnection: {
    set: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue("fake-instance-id"),
    del: vi.fn().mockResolvedValue(1)
  }
}));

describe("WorkspaceInviteExpiryScheduler", () => {
  beforeEach(async () => {
    await prisma.schedulerRunStatus.deleteMany({
      where: { name: WORKSPACE_INVITE_EXPIRY_SCHEDULER_NAME }
    });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await workspaceInviteExpiryScheduler.stop();
  });

  it("should run successfully and update status", async () => {
    const result = await workspaceInviteExpiryScheduler.runOnce("manual");
    expect(result.errors).toBe(0);
    
    const status = await prisma.schedulerRunStatus.findUnique({
      where: { name: WORKSPACE_INVITE_EXPIRY_SCHEDULER_NAME }
    });
    
    expect(status).not.toBeNull();
    expect(status?.lastStatus).toBe("success");
    expect(status?.runCount).toBe(1);
    expect(status?.lastSummary).toContain("scanned");
  });
});
