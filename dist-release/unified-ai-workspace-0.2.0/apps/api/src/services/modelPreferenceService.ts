import { prisma } from "./prisma.js";
import { providerRegistry } from "./providerRegistry.js";
import { getProviderHealth } from "./providerHealthService.js";
import { OPENAI_COMPAT_MODELS } from "./openaiCompatModels.js";
import type { ProviderId } from "@uaiw/shared/types/provider.js";
import {
  getEffectiveRecoveryState,
  getModelRecoveryStatus,
  getModelRecoveryStatusFromState,
  type EffectiveRecoveryState
} from "./providerRecoveryOverrideService.js";

export interface ModelRecoveryMetadata {
  providerDegraded: boolean;
  degradedMode?: "avoid_if_possible" | "block_for_duration";
  degradedUntil?: string;
  degradedReason?: string;
  temporarilyDisabled: boolean;
  disabledUntil?: string;
  disabledReason?: string;
}

export interface ModelPreferenceView {
  modelId: string;
  provider: ProviderId;
  displayName: string;
  enabled: boolean;
  isDefault: boolean;
  priority: number;
  readiness: string;
  healthStatus: string;
  isUsable: boolean;
  requiresLogin: boolean;
  capabilities: string[];
  subModels: import("@uaiw/shared/types/provider.js").ProviderSubModel[];
  selectedSubModelId: string;
  selectedSubModelLabel: string;
  recovery: ModelRecoveryMetadata;
}

export interface UpdateModelPreferencesInput {
  autoSelectFirstUsable: boolean;
  models: Array<{
    modelId: string;
    enabled: boolean;
    isDefault: boolean;
    priority: number;
    selectedSubModelId?: string;
  }>;
}

export async function getModelPreferences(userId: string): Promise<{
  models: ModelPreferenceView[];
  autoSelectFirstUsable: boolean;
}> {
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const autoSelectFirstUsable = settings?.autoSelectFirstUsable ?? true;

  const userPrefs = await prisma.userModelPreference.findMany({
    where: { userId }
  });
  const prefsByModel = new Map(userPrefs.map(p => [p.modelId, p]));

  const healthData = await getProviderHealth(userId);
  const healthByProvider = new Map(healthData.map(h => [h.provider, h]));
  const recoveryState = await getEffectiveRecoveryState(userId);

  const allModels = Object.entries(OPENAI_COMPAT_MODELS).map(([modelId, def]) => {
    return { modelId, ...def };
  });

  const views: ModelPreferenceView[] = allModels.map((m, index) => {
    const pref = prefsByModel.get(m.modelId);
    const health = healthByProvider.get(m.provider);
    const recovery = modelRecoveryMetadata(recoveryState, m.modelId, m.provider);
    const temporarilyBlocked = recovery.temporarilyDisabled || recovery.degradedMode === "block_for_duration";
    const baseUsable = health?.isUsable || false;

    return {
      modelId: m.modelId,
      provider: m.provider,
      displayName: m.displayName,
      enabled: pref ? pref.enabled : true,
      isDefault: pref ? pref.isDefault : false,
      priority: pref ? pref.priority : (index + 1) * 10,
      readiness: health?.readiness || "unknown",
      healthStatus: health?.healthStatus || "unknown",
      isUsable: baseUsable && !temporarilyBlocked,
      requiresLogin: health?.requiresLogin || false,
      capabilities: health?.capabilities || [],
      subModels: providerRegistry.get(m.provider).definition.subModels || [
        { id: "current", label: "Current / Provider default", available: true }
      ],
      selectedSubModelId: pref?.selectedSubModelId || "current",
      selectedSubModelLabel: pref?.selectedSubModelLabel || "Current / Provider default",
      recovery
    };
  });

  // If no default exists, we can dynamically pick one.
  const hasDefault = views.some(v => v.isDefault);
  if (!hasDefault && views.length > 0) {
    views.sort((a, b) => a.priority - b.priority);
    // Prefer the first usable one if possible, otherwise just the first enabled
    const fallback = pickPreferredFallback(views, recoveryState) || views.find(v => v.isUsable && v.enabled) || views.find(v => v.enabled) || views[0];
    fallback.isDefault = true;
  }

  return {
    models: views,
    autoSelectFirstUsable
  };
}

export async function updateModelPreferences(
  userId: string,
  input: UpdateModelPreferencesInput
): Promise<{ models: ModelPreferenceView[]; autoSelectFirstUsable: boolean }> {
  // Update or create UserSettings
  await prisma.userSettings.upsert({
    where: { userId },
    update: { autoSelectFirstUsable: input.autoSelectFirstUsable },
    create: { userId, autoSelectFirstUsable: input.autoSelectFirstUsable }
  });

  // Bulk upsert Model Preferences
  // SQLite does not support bulk upsert, so we use transaction
  const queries = input.models.map(m => {
    const provider = OPENAI_COMPAT_MODELS[m.modelId]?.provider || "unknown";
    return prisma.userModelPreference.upsert({
      where: { userId_modelId: { userId, modelId: m.modelId } },
      update: {
        enabled: m.enabled,
        isDefault: m.isDefault,
        priority: m.priority,
        selectedSubModelId: m.selectedSubModelId || "current",
        selectedSubModelLabel: providerRegistry.get(provider as ProviderId).definition.subModels?.find(s => s.id === (m.selectedSubModelId || "current"))?.label || "Current / Provider default"
      },
      create: {
        userId,
        modelId: m.modelId,
        provider,
        enabled: m.enabled,
        isDefault: m.isDefault,
        priority: m.priority,
        selectedSubModelId: m.selectedSubModelId || "current",
        selectedSubModelLabel: providerRegistry.get(provider as ProviderId).definition.subModels?.find(s => s.id === (m.selectedSubModelId || "current"))?.label || "Current / Provider default"
      }
    });
  });

  await prisma.$transaction(queries);

  return getModelPreferences(userId);
}

export async function setDefaultModel(userId: string, modelId: string): Promise<void> {
  const current = await getModelPreferences(userId);
  const updatedModels = current.models.map(m => ({
    modelId: m.modelId,
    enabled: m.enabled,
    isDefault: m.modelId === modelId,
    priority: m.priority,
    selectedSubModelId: m.selectedSubModelId
  }));

  await updateModelPreferences(userId, {
    autoSelectFirstUsable: current.autoSelectFirstUsable,
    models: updatedModels
  });
}

export async function resolveDefaultModel(userId: string): Promise<string | null> {
  const { models, autoSelectFirstUsable } = await getModelPreferences(userId);
  const enabledModels = models.filter(m => m.enabled);
  if (enabledModels.length === 0) return null;

  const currentDefault = enabledModels.find(m => m.isDefault);
  const recoveryState = await getEffectiveRecoveryState(userId);
  const recoveryFallback = pickPreferredFallback(enabledModels, recoveryState, currentDefault?.provider);
  if (autoSelectFirstUsable && recoveryFallback) {
    return recoveryFallback.modelId;
  }
  
  if (currentDefault) {
    const avoidDegraded =
      currentDefault.recovery.providerDegraded &&
      currentDefault.recovery.degradedMode !== "block_for_duration" &&
      Boolean(enabledModels.find(m => m.enabled && m.isUsable && m.provider !== currentDefault.provider));
    if ((currentDefault.isUsable && !avoidDegraded) || !autoSelectFirstUsable) {
      return currentDefault.modelId;
    }
  }

  // If default is not usable and autoSelectFirstUsable is true,
  // or if there is no default, fallback to highest priority usable model
  if (autoSelectFirstUsable) {
    enabledModels.sort((a, b) => a.priority - b.priority);
    const usable = enabledModels.find(m => m.isUsable);
    if (usable) return usable.modelId;
  }

  return currentDefault?.modelId || enabledModels.sort((a, b) => a.priority - b.priority)[0]?.modelId || null;
}

export async function isModelEnabled(userId: string, modelId: string): Promise<boolean> {
  const prefs = await getModelPreferences(userId);
  const model = prefs.models.find(m => m.modelId === modelId);
  return model?.enabled ?? false;
}

export async function getModelTemporaryDisable(userId: string, modelId: string) {
  const provider = OPENAI_COMPAT_MODELS[modelId]?.provider;
  const recovery = await getModelRecoveryStatus(userId, modelId, provider);
  if (!recovery.temporarilyDisabled) return null;
  return {
    until: recovery.disabledUntil,
    reason: recovery.disabledReason
  };
}

export async function getEnabledModels(userId: string): Promise<ModelPreferenceView[]> {
  const prefs = await getModelPreferences(userId);
  return prefs.models.filter(m => m.enabled);
}

function modelRecoveryMetadata(state: EffectiveRecoveryState, modelId: string, provider: ProviderId): ModelRecoveryMetadata {
  const status = getModelRecoveryStatusFromState(state, modelId, provider);
  return {
    providerDegraded: status.providerDegraded,
    degradedMode: status.degradedMode,
    degradedUntil: status.degradedUntil,
    degradedReason: status.degradedReason,
    temporarilyDisabled: status.temporarilyDisabled,
    disabledUntil: status.disabledUntil,
    disabledReason: status.disabledReason
  };
}

function pickPreferredFallback(
  models: ModelPreferenceView[],
  recoveryState: EffectiveRecoveryState,
  currentProvider?: ProviderId
) {
  for (const fallback of recoveryState.preferredFallbackOrder) {
    if (currentProvider && fallback.onlyIfProvider && fallback.onlyIfProvider !== currentProvider) continue;
    for (const provider of fallback.fallbackProviderOrder) {
      const model = models.find(item => item.provider === provider && item.enabled && item.isUsable);
      if (model) return model;
    }
  }
  return null;
}
