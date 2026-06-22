import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../prisma.js";
import { 
  getModelPreferences, 
  updateModelPreferences, 
  getModelTemporaryDisable,
  resolveDefaultModel,
  isModelEnabled,
  setDefaultModel 
} from "../modelPreferenceService.js";
import { withTestUserScope } from "../../test/testIsolation.js";
import { createRecoveryOverride } from "../providerRecoveryOverrideService.js";

vi.mock("../providerHealthService.js", () => {
  return {
    getProviderHealth: vi.fn().mockResolvedValue([
      { provider: "chatgpt", isUsable: true, healthStatus: "healthy" },
      { provider: "gemini", isUsable: false, healthStatus: "requires_login" },
      { provider: "grok", isUsable: true, healthStatus: "healthy" }
    ])
  };
});

describe("modelPreferenceService", () => {
  const scope = withTestUserScope("model-pref");
  const userId = scope.userId;

  beforeEach(async () => {

    await prisma.workspace.upsert({
      where: { id: "test-ws" },
      update: {},
      create: { id: "test-ws", name: "Test Workspace", slug: "test-ws-" + Math.random().toString(36).substring(7) }
    });

    await scope.cleanup();
    await prisma.user.create({
      data: {
        id: userId,
        email: scope.email
      }
    });
  });

  afterEach(async () => {
    await scope.cleanup();
    vi.clearAllMocks();
  });

  it("should generate default preferences when no rows exist", async () => {
    const prefs = await getModelPreferences(userId);
    expect(prefs.autoSelectFirstUsable).toBe(true);
    expect(prefs.models.length).toBeGreaterThan(0);

    const chatgpt = prefs.models.find(m => m.modelId === "chatgpt-web");
    expect(chatgpt?.enabled).toBe(true);
    
    // Default should fall back to first usable enabled
    const defaultModel = prefs.models.find(m => m.isDefault);
    expect(defaultModel?.isUsable).toBe(true);
  });

  it("should save and retrieve user preferences", async () => {
    await updateModelPreferences(userId, "test-ws", {
      autoSelectFirstUsable: false,
      models: [
        { modelId: "chatgpt-web", enabled: true, isDefault: true, priority: 10 },
        { modelId: "gemini-web", enabled: false, isDefault: false, priority: 20 },
        { modelId: "grok-web", enabled: true, isDefault: false, priority: 30 }
      ]
    });

    const prefs = await getModelPreferences(userId);
    expect(prefs.autoSelectFirstUsable).toBe(false);
    
    const chatgpt = prefs.models.find(m => m.modelId === "chatgpt-web");
    expect(chatgpt?.enabled).toBe(true);
    expect(chatgpt?.isDefault).toBe(true);

    const gemini = prefs.models.find(m => m.modelId === "gemini-web");
    expect(gemini?.enabled).toBe(false);

    expect(await isModelEnabled(userId, "gemini-web")).toBe(false);
    expect(await isModelEnabled(userId, "chatgpt-web")).toBe(true);
  });

  it("should set default model correctly and clear others", async () => {
    await updateModelPreferences(userId, "test-ws", {
      autoSelectFirstUsable: true,
      models: [
        { modelId: "chatgpt-web", enabled: true, isDefault: false, priority: 10 },
        { modelId: "gemini-web", enabled: true, isDefault: true, priority: 20 },
      ]
    });

    await setDefaultModel(userId, "test-ws", "chatgpt-web");

    const prefs = await getModelPreferences(userId);
    const chatgpt = prefs.models.find(m => m.modelId === "chatgpt-web");
    const gemini = prefs.models.find(m => m.modelId === "gemini-web");

    expect(chatgpt?.isDefault).toBe(true);
    expect(gemini?.isDefault).toBe(false);
  });

  it("should resolve default model with auto fallback", async () => {
    // gemini is default but not usable (from mock). autoSelectFirstUsable is true.
    await updateModelPreferences(userId, "test-ws", {
      autoSelectFirstUsable: true,
      models: [
        { modelId: "gemini-web", enabled: true, isDefault: true, priority: 10 },
        { modelId: "grok-web", enabled: true, isDefault: false, priority: 20 },
        { modelId: "chatgpt-web", enabled: true, isDefault: false, priority: 30 }
      ]
    });

    const resolved = await resolveDefaultModel(userId);
    // Since gemini is not usable, and auto fallback is true, it should pick the next highest priority usable model -> grok
    expect(resolved).toBe("grok-web");
  });

  it("should not fallback if autoSelectFirstUsable is false", async () => {
    // gemini is default but not usable. autoSelectFirstUsable is false.
    await updateModelPreferences(userId, "test-ws", {
      autoSelectFirstUsable: false,
      models: [
        { modelId: "gemini-web", enabled: true, isDefault: true, priority: 10 },
        { modelId: "grok-web", enabled: true, isDefault: false, priority: 20 }
      ]
    });

    const resolved = await resolveDefaultModel(userId);
    // Should strictly return gemini-web despite being unusable
    expect(resolved).toBe("gemini-web");
  });

  it("marks temporarily disabled models unusable without changing permanent preference", async () => {
    await updateModelPreferences(userId, "test-ws", {
      autoSelectFirstUsable: true,
      models: [
        { modelId: "chatgpt-web", enabled: true, isDefault: true, priority: 10 },
        { modelId: "grok-web", enabled: true, isDefault: false, priority: 20 }
      ]
    });
    await createRecoveryOverride({
      userId,
      actionType: "disable_model_temporarily",
      provider: "chatgpt",
      modelId: "chatgpt-web",
      durationMinutes: 30,
      overrideState: { modelId: "chatgpt-web" }
    });

    const prefs = await getModelPreferences(userId);
    const chatgpt = prefs.models.find(m => m.modelId === "chatgpt-web");
    expect(chatgpt?.enabled).toBe(true);
    expect(chatgpt?.isUsable).toBe(false);
    expect(chatgpt?.recovery.temporarilyDisabled).toBe(true);

    const rawPref = await prisma.userModelPreference.findFirstOrThrow({ where: { userId, modelId: "chatgpt-web" } });
    expect(rawPref.enabled).toBe(true);
    expect(rawPref.isDefault).toBe(true);
  });

  it("ignores past-due active temporary disables before scheduler cleanup", async () => {
    await updateModelPreferences(userId, "test-ws", {
      autoSelectFirstUsable: true,
      models: [
        { modelId: "chatgpt-web", enabled: true, isDefault: true, priority: 10 },
        { modelId: "grok-web", enabled: true, isDefault: false, priority: 20 }
      ]
    });
    await prisma.providerRecoveryOverride.create({
      data: {
        userId,
        actionType: "disable_model_temporarily",
        provider: "chatgpt",
        modelId: "chatgpt-web",
        status: "active",
        overrideState: JSON.stringify({ modelId: "chatgpt-web" }),
        previousState: JSON.stringify({ type: "virtual_override" }),
        startsAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 60_000)
      }
    });

    const prefs = await getModelPreferences(userId);
    const chatgpt = prefs.models.find(m => m.modelId === "chatgpt-web");
    expect(chatgpt?.enabled).toBe(true);
    expect(chatgpt?.isUsable).toBe(true);
    expect(chatgpt?.recovery.temporarilyDisabled).toBe(false);
    await expect(getModelTemporaryDisable(userId, "chatgpt-web")).resolves.toBeNull();
  });

  it("prefers temporary fallback provider for automatic selection", async () => {
    await updateModelPreferences(userId, "test-ws", {
      autoSelectFirstUsable: true,
      models: [
        { modelId: "chatgpt-web", enabled: true, isDefault: true, priority: 10 },
        { modelId: "grok-web", enabled: true, isDefault: false, priority: 20 }
      ]
    });
    await createRecoveryOverride({
      userId,
      actionType: "prefer_fallback_provider",
      provider: "chatgpt",
      durationMinutes: 30,
      overrideState: {
        onlyIfProvider: "chatgpt",
        fallbackProviderOrder: ["grok", "gemini"]
      }
    });

    await expect(resolveDefaultModel(userId)).resolves.toBe("grok-web");
  });

  it("blocks provider only when degraded mode is block_for_duration", async () => {
    await createRecoveryOverride({
      userId,
      actionType: "mark_provider_temporarily_degraded",
      provider: "grok",
      durationMinutes: 30,
      overrideState: { mode: "block_for_duration" }
    });

    const prefs = await getModelPreferences(userId);
    const grok = prefs.models.find(m => m.modelId === "grok-web");
    expect(grok?.isUsable).toBe(false);
    expect(grok?.recovery.providerDegraded).toBe(true);
    expect(grok?.recovery.degradedMode).toBe("block_for_duration");
  });
});
