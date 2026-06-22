import { describe, expect, it, vi } from "vitest";
import {
  getOnboardingStatus,
  markOnboardingComplete,
  skipOnboarding,
  updateOnboardingStatus
} from "../onboardingService.js";
import { prisma } from "../prisma.js";
import { getModelPreferences } from "../modelPreferenceService.js";
import { getProviderHealth, refreshProviderHealth } from "../providerHealthService.js";

vi.mock("../modelPreferenceService.js", () => ({
  getModelPreferences: vi.fn()
}));

vi.mock("../providerHealthService.js", () => ({
  getProviderHealth: vi.fn(),
  refreshProviderHealth: vi.fn()
}));

vi.mock("../prisma.js", () => ({
  prisma: {
    userSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn()
    },
    internalApiKey: {
      count: vi.fn()
    },
    internalApiUsageLog: {
      count: vi.fn()
    }
  }
}));

const userId = "onboarding-user";

describe("onboardingService", () => {
  it("recommends connect_provider with no provider or key", async () => {
    mockState({
      providers: [provider("chatgpt", "not_connected", false)],
      models: [model("chatgpt-web", false, false, true)],
      activeKeys: 0,
      usage: 0
    });

    const status = await getOnboardingStatus(userId);

    expect(status.recommendedNextStep).toBe("connect_provider");
    expect(status.checklist.hasConnectedProvider).toBe(false);
    expect(refreshProviderHealth).not.toHaveBeenCalled();
  });

  it("recommends choose_model when provider is usable but no default is selected", async () => {
    mockState({
      providers: [provider("gemini", "connected", true)],
      models: [model("gemini-web", true, false, true)],
      activeKeys: 0,
      usage: 0
    });

    await expect(getOnboardingStatus(userId)).resolves.toMatchObject({
      recommendedNextStep: "choose_model",
      checklist: { hasUsableModel: true, hasDefaultModel: false }
    });
  });

  it("recommends create_api_key when default model exists without key", async () => {
    mockState({
      providers: [provider("gemini", "connected", true)],
      models: [model("gemini-web", true, true, true)],
      activeKeys: 0,
      usage: 0
    });

    await expect(getOnboardingStatus(userId)).resolves.toMatchObject({
      recommendedNextStep: "create_api_key"
    });
  });

  it("recommends test_endpoint when a key exists but no usage has been recorded", async () => {
    mockState({
      providers: [provider("gemini", "connected", true)],
      models: [model("gemini-web", true, true, true)],
      activeKeys: 1,
      usage: 0
    });

    await expect(getOnboardingStatus(userId)).resolves.toMatchObject({
      recommendedNextStep: "test_endpoint"
    });
  });

  it("stores last step updates", async () => {
    mockState({
      providers: [],
      models: [],
      activeKeys: 0,
      usage: 0,
      settings: { onboardingLastStep: "choose_model" }
    });
    vi.mocked(prisma.userSettings.upsert).mockResolvedValueOnce({} as any);

    await updateOnboardingStatus(userId, { lastStep: "choose_model" });

    expect(prisma.userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId },
      update: { onboardingLastStep: "choose_model" }
    }));
  });

  it("mark complete stores timestamp", async () => {
    mockState({
      providers: [],
      models: [],
      activeKeys: 0,
      usage: 0,
      settings: { onboardingCompletedAt: new Date("2026-06-21T10:00:00.000Z"), onboardingLastStep: "done" }
    });
    vi.mocked(prisma.userSettings.upsert).mockResolvedValueOnce({} as any);

    await markOnboardingComplete(userId);

    expect(prisma.userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ onboardingLastStep: "done" })
    }));
  });

  it("skip stores timestamp", async () => {
    mockState({
      providers: [],
      models: [],
      activeKeys: 0,
      usage: 0,
      settings: { onboardingSkippedAt: new Date("2026-06-21T10:00:00.000Z"), onboardingLastStep: "skipped" }
    });
    vi.mocked(prisma.userSettings.upsert).mockResolvedValueOnce({} as any);

    await skipOnboarding(userId);

    expect(prisma.userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ onboardingLastStep: "skipped" })
    }));
  });
});

function mockState(input: {
  providers: any[];
  models: any[];
  activeKeys: number;
  usage: number;
  settings?: Record<string, unknown> | null;
}) {
  vi.clearAllMocks();
  vi.mocked(prisma.userSettings.findUnique).mockResolvedValue(input.settings as any ?? null);
  vi.mocked(getProviderHealth).mockResolvedValue(input.providers as any);
  vi.mocked(getModelPreferences).mockResolvedValue({ models: input.models as any, autoSelectFirstUsable: true });
  vi.mocked(prisma.internalApiKey.count).mockResolvedValue(input.activeKeys);
  vi.mocked(prisma.internalApiUsageLog.count).mockResolvedValue(input.usage);
}

function provider(providerId: string, status: string, isUsable: boolean) {
  return {
    provider: providerId,
    displayName: providerId,
    connectionStatus: status,
    healthStatus: isUsable ? "healthy" : status,
    isUsable
  };
}

function model(modelId: string, isUsable: boolean, isDefault: boolean, enabled: boolean) {
  return {
    modelId,
    provider: modelId.split("-")[0],
    displayName: modelId,
    enabled,
    isUsable,
    isDefault
  };
}
