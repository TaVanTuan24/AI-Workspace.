import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../prisma.js";
import {
  getNotificationPreferences,
  updateNotificationPreferences
} from "../notificationPreferenceService.js";

describe("notificationPreferenceService", () => {
  beforeEach(async () => {
    await prisma.userSettings.deleteMany({ where: { userId: { in: ["notify-user-a", "notify-user-b"] } } });
    await prisma.user.deleteMany({ where: { id: { in: ["notify-user-a", "notify-user-b"] } } });
    await prisma.user.createMany({
      data: [
        { id: "notify-user-a", email: "notify-a@local.com" },
        { id: "notify-user-b", email: "notify-b@local.com" }
      ]
    });
  });

  afterEach(async () => {
    await prisma.userSettings.deleteMany({ where: { userId: { in: ["notify-user-a", "notify-user-b"] } } });
    await prisma.user.deleteMany({ where: { id: { in: ["notify-user-a", "notify-user-b"] } } });
  });

  it("creates and returns default preferences", async () => {
    await expect(getNotificationPreferences("notify-user-a")).resolves.toEqual({
      notifyProviderSessionIssues: true,
      notifyNoUsableModels: true,
      notifyProviderLimitSpikes: true,
      providerLimitSpikeThreshold24h: 10
    });
  });

  it("updates booleans and threshold", async () => {
    const preferences = await updateNotificationPreferences("notify-user-a", {
      notifyProviderSessionIssues: false,
      notifyNoUsableModels: false,
      notifyProviderLimitSpikes: false,
      providerLimitSpikeThreshold24h: 25
    });

    expect(preferences).toEqual({
      notifyProviderSessionIssues: false,
      notifyNoUsableModels: false,
      notifyProviderLimitSpikes: false,
      providerLimitSpikeThreshold24h: 25
    });
  });

  it("rejects thresholds outside the allowed range", async () => {
    await expect(
      updateNotificationPreferences("notify-user-a", { providerLimitSpikeThreshold24h: 0 })
    ).rejects.toThrow("integer from 1 to 10000");
    await expect(
      updateNotificationPreferences("notify-user-a", { providerLimitSpikeThreshold24h: 10001 })
    ).rejects.toThrow("integer from 1 to 10000");
  });

  it("scopes updates by user", async () => {
    await updateNotificationPreferences("notify-user-a", { notifyProviderLimitSpikes: false });
    const other = await getNotificationPreferences("notify-user-b");
    expect(other.notifyProviderLimitSpikes).toBe(true);
  });
});
