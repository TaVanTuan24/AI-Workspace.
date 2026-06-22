import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../prisma.js";
import {
  getNotificationDeliveryPreferences,
  updateNotificationDeliveryPreference
} from "../notificationDeliveryPreferenceService.js";

describe("notificationDeliveryPreferenceService", () => {
  const userId = "test-delivery-pref-user";

  beforeEach(async () => {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, email: "pref-test@example.com" }
    });
    await prisma.notificationDeliveryPreference.deleteMany({
      where: { userId }
    });
  });

  it("returns default preferences with in_app enabled", async () => {
    const prefs = await getNotificationDeliveryPreferences(userId);
    expect(prefs).toHaveLength(5);

    const inApp = prefs.find(p => p.channel === "in_app");
    expect(inApp?.enabled).toBe(true);
    expect(inApp?.configured).toBe(true);

    const email = prefs.find(p => p.channel === "email_noop");
    expect(email?.enabled).toBe(false);
    expect(email?.configured).toBe(false);
  });

  it("allows enabling a noop channel", async () => {
    const pref = await updateNotificationDeliveryPreference(userId, "email_noop", { enabled: true });
    expect(pref.enabled).toBe(true);
    expect(pref.configured).toBe(false);

    const prefs = await getNotificationDeliveryPreferences(userId);
    const email = prefs.find(p => p.channel === "email_noop");
    expect(email?.enabled).toBe(true);
  });

  it("prevents disabling in_app channel", async () => {
    const pref = await updateNotificationDeliveryPreference(userId, "in_app", { enabled: false });
    // Should stay enabled
    expect(pref.enabled).toBe(true);

    const prefs = await getNotificationDeliveryPreferences(userId);
    const inApp = prefs.find(p => p.channel === "in_app");
    expect(inApp?.enabled).toBe(true);
  });
});
