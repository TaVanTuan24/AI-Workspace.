import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../prisma.js";
import { 
  getModelPreferences, 
  updateModelPreferences, 
  resolveDefaultModel,
  isModelEnabled,
  setDefaultModel 
} from "../modelPreferenceService.js";

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
  const userId = "test-user-models";

  beforeEach(async () => {
    await prisma.userModelPreference.deleteMany({});
    await prisma.userSettings.deleteMany({});
    await prisma.user.deleteMany({ where: { id: userId } });

    await prisma.user.create({
      data: {
        id: userId,
        email: "test-models@local.com"
      }
    });
  });

  afterEach(async () => {
    await prisma.userModelPreference.deleteMany({});
    await prisma.userSettings.deleteMany({});
    await prisma.user.deleteMany({ where: { id: userId } });
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
    await updateModelPreferences(userId, {
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
    await updateModelPreferences(userId, {
      autoSelectFirstUsable: true,
      models: [
        { modelId: "chatgpt-web", enabled: true, isDefault: false, priority: 10 },
        { modelId: "gemini-web", enabled: true, isDefault: true, priority: 20 },
      ]
    });

    await setDefaultModel(userId, "chatgpt-web");

    const prefs = await getModelPreferences(userId);
    const chatgpt = prefs.models.find(m => m.modelId === "chatgpt-web");
    const gemini = prefs.models.find(m => m.modelId === "gemini-web");

    expect(chatgpt?.isDefault).toBe(true);
    expect(gemini?.isDefault).toBe(false);
  });

  it("should resolve default model with auto fallback", async () => {
    // gemini is default but not usable (from mock). autoSelectFirstUsable is true.
    await updateModelPreferences(userId, {
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
    await updateModelPreferences(userId, {
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
});
