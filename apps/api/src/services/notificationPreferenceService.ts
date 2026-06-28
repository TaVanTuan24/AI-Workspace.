import { prisma } from "./prisma.js";

export interface NotificationPreferences {
  notifyProviderSessionIssues: boolean;
  notifyNoUsableModels: boolean;
  notifyProviderLimitSpikes: boolean;
  providerLimitSpikeThreshold24h: number;
}

export interface UpdateNotificationPreferencesInput {
  notifyProviderSessionIssues?: boolean;
  notifyNoUsableModels?: boolean;
  notifyProviderLimitSpikes?: boolean;
  providerLimitSpikeThreshold24h?: number;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  notifyProviderSessionIssues: true,
  notifyNoUsableModels: true,
  notifyProviderLimitSpikes: true,
  providerLimitSpikeThreshold24h: 10
};

export function defaultNotificationPreferences(): NotificationPreferences {
  return { ...DEFAULT_PREFERENCES };
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const settings = await prisma.userSettings.upsert({
    where: { userId },
    create: {
      userId,
      ...DEFAULT_PREFERENCES
    },
    update: {}
  });
  return mapPreferences(settings);
}

export async function updateNotificationPreferences(
  userId: string,
  input: UpdateNotificationPreferencesInput
): Promise<NotificationPreferences> {
  validateNotificationPreferences(input);
  const data = {
    ...(input.notifyProviderSessionIssues !== undefined ? { notifyProviderSessionIssues: input.notifyProviderSessionIssues } : {}),
    ...(input.notifyNoUsableModels !== undefined ? { notifyNoUsableModels: input.notifyNoUsableModels } : {}),
    ...(input.notifyProviderLimitSpikes !== undefined ? { notifyProviderLimitSpikes: input.notifyProviderLimitSpikes } : {}),
    ...(input.providerLimitSpikeThreshold24h !== undefined ? { providerLimitSpikeThreshold24h: input.providerLimitSpikeThreshold24h } : {})
  };
  const settings = await prisma.userSettings.upsert({
    where: { userId },
    create: {
      userId,
      ...DEFAULT_PREFERENCES,
      ...data
    },
    update: data
  });
  return mapPreferences(settings);
}

export function validateNotificationPreferences(input: UpdateNotificationPreferencesInput): void {
  if (input.providerLimitSpikeThreshold24h !== undefined) {
    const threshold = input.providerLimitSpikeThreshold24h;
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 10_000) {
      throw new Error("providerLimitSpikeThreshold24h must be an integer from 1 to 10000.");
    }
  }
}

function mapPreferences(settings: {
  notifyProviderSessionIssues: boolean;
  notifyNoUsableModels: boolean;
  notifyProviderLimitSpikes: boolean;
  providerLimitSpikeThreshold24h: number;
}): NotificationPreferences {
  return {
    notifyProviderSessionIssues: settings.notifyProviderSessionIssues,
    notifyNoUsableModels: settings.notifyNoUsableModels,
    notifyProviderLimitSpikes: settings.notifyProviderLimitSpikes,
    providerLimitSpikeThreshold24h: settings.providerLimitSpikeThreshold24h
  };
}
