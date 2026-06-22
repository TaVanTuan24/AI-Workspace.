import { prisma } from "./prisma.js";
import { getModelPreferences } from "./modelPreferenceService.js";
import { getProviderHealth } from "./providerHealthService.js";

export type OnboardingStep =
  | "welcome"
  | "connect_provider"
  | "choose_model"
  | "create_api_key"
  | "test_endpoint"
  | "backup"
  | "finish"
  | "done";

export interface OnboardingStatus {
  completed: boolean;
  skipped: boolean;
  completedAt?: string | null;
  skippedAt?: string | null;
  lastStep?: string | null;
  recommendedNextStep:
    | "connect_provider"
    | "choose_model"
    | "create_api_key"
    | "test_endpoint"
    | "backup"
    | "done";
  checklist: {
    hasConnectedProvider: boolean;
    hasUsableModel: boolean;
    hasDefaultModel: boolean;
    hasActiveApiKey: boolean;
    hasUsage: boolean;
  };
}

export interface UpdateOnboardingStatusInput {
  lastStep?: string | null;
  completed?: boolean;
  skipped?: boolean;
}

export async function getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
  const [settings, providerHealth, modelPreferences, activeApiKeys, usageCount] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId } }),
    getProviderHealth(userId),
    getModelPreferences(userId),
    prisma.internalApiKey.count({ where: { userId, status: "active" } }),
    prisma.internalApiUsageLog.count({ where: { userId } })
  ]);

  const enabledModels = modelPreferences.models.filter((model) => model.enabled);
  const checklist = {
    hasConnectedProvider: providerHealth.some((provider) => provider.connectionStatus === "connected"),
    hasUsableModel: enabledModels.some((model) => model.isUsable),
    hasDefaultModel: enabledModels.some((model) => model.isDefault),
    hasActiveApiKey: activeApiKeys > 0,
    hasUsage: usageCount > 0
  };

  const completed = Boolean(settings?.onboardingCompletedAt);
  const skipped = Boolean(settings?.onboardingSkippedAt) && !completed;

  return {
    completed,
    skipped,
    completedAt: settings?.onboardingCompletedAt?.toISOString() ?? null,
    skippedAt: settings?.onboardingSkippedAt?.toISOString() ?? null,
    lastStep: settings?.onboardingLastStep ?? null,
    recommendedNextStep: completed ? "done" : recommendedNextStep(checklist),
    checklist
  };
}

export async function updateOnboardingStatus(
  userId: string,
  input: UpdateOnboardingStatusInput
): Promise<OnboardingStatus> {
  if (input.completed) return markOnboardingComplete(userId);
  if (input.skipped) return skipOnboarding(userId);

  await prisma.userSettings.upsert({
    where: { userId },
    create: {
      userId,
      autoSelectFirstUsable: true,
      onboardingLastStep: normalizeStep(input.lastStep)
    },
    update: {
      onboardingLastStep: normalizeStep(input.lastStep)
    }
  });

  return getOnboardingStatus(userId);
}

export async function markOnboardingComplete(userId: string): Promise<OnboardingStatus> {
  await prisma.userSettings.upsert({
    where: { userId },
    create: {
      userId,
      autoSelectFirstUsable: true,
      onboardingCompletedAt: new Date(),
      onboardingLastStep: "done"
    },
    update: {
      onboardingCompletedAt: new Date(),
      onboardingLastStep: "done"
    }
  });

  return getOnboardingStatus(userId);
}

export async function skipOnboarding(userId: string): Promise<OnboardingStatus> {
  await prisma.userSettings.upsert({
    where: { userId },
    create: {
      userId,
      autoSelectFirstUsable: true,
      onboardingSkippedAt: new Date(),
      onboardingLastStep: "skipped"
    },
    update: {
      onboardingSkippedAt: new Date(),
      onboardingLastStep: "skipped"
    }
  });

  return getOnboardingStatus(userId);
}

function recommendedNextStep(checklist: OnboardingStatus["checklist"]): OnboardingStatus["recommendedNextStep"] {
  if (!checklist.hasConnectedProvider || !checklist.hasUsableModel) return "connect_provider";
  if (!checklist.hasDefaultModel) return "choose_model";
  if (!checklist.hasActiveApiKey) return "create_api_key";
  if (!checklist.hasUsage) return "test_endpoint";
  return "backup";
}

function normalizeStep(step?: string | null) {
  if (!step) return null;
  const allowed = new Set(["welcome", "connect_provider", "choose_model", "create_api_key", "test_endpoint", "backup", "finish", "done"]);
  return allowed.has(step) ? step : null;
}
