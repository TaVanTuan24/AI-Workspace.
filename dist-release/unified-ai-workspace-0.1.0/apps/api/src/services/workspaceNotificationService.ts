import type { ProviderId, WorkspaceNotification } from "@uaiw/shared/types/provider.js";
import { getProviderLimitAnalytics } from "./apiUsageService.js";
import { getModelPreferences } from "./modelPreferenceService.js";
import { getNotificationPreferences } from "./notificationPreferenceService.js";
import { getProviderHealth, type ProviderHealth } from "./providerHealthService.js";
import { materializeNotificationEvents } from "./notificationEventService.js";

const providerDisplayNames: Record<ProviderId, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok"
};

export async function getWorkspaceNotifications(
  userId: string,
  options?: { materializeEvents?: boolean }
): Promise<WorkspaceNotification[]> {
  const [healths, preferences, notificationPreferences] = await Promise.all([
    getProviderHealth(userId),
    getModelPreferences(userId),
    getNotificationPreferences(userId)
  ]);

  const enabledModels = preferences.models.filter((model) => model.enabled);
  const enabledByProvider = new Map<ProviderId, typeof enabledModels>();
  for (const model of enabledModels) {
    const current = enabledByProvider.get(model.provider) ?? [];
    current.push(model);
    enabledByProvider.set(model.provider, current);
  }

  const notifications: WorkspaceNotification[] = [];
  if (notificationPreferences.notifyProviderSessionIssues) {
    for (const health of healths) {
      const modelsForProvider = enabledByProvider.get(health.provider) ?? [];
      if (modelsForProvider.length === 0) continue;

      const notification = buildProviderNotification(health, modelsForProvider[0].modelId);
      if (notification) notifications.push(notification);
    }
  }

  if (notificationPreferences.notifyNoUsableModels && !enabledModels.some((model) => model.isUsable)) {
    notifications.push({
      id: "no_usable_models",
      severity: "critical",
      kind: "no_usable_models",
      title: "No usable models",
      message: "No enabled provider models are currently usable. Reconnect a provider or adjust model settings.",
      action: {
        label: "Open connections",
        href: "/connections"
      },
      dismissible: false,
      fingerprint: "no_usable_models",
      createdFromStatusAt: null
    });
  }

  if (notificationPreferences.notifyProviderLimitSpikes) {
    const limitAnalytics = await getProviderLimitAnalytics(userId, { range: "24h" });
    for (const item of limitAnalytics.byProvider) {
      if (item.hits < notificationPreferences.providerLimitSpikeThreshold24h) continue;
      notifications.push(buildProviderLimitSpikeNotification({
        provider: item.provider,
        hits: item.hits,
        threshold: notificationPreferences.providerLimitSpikeThreshold24h
      }));
    }
  }

  if (options?.materializeEvents) {
    // Determine which notifications are worth materializing as history events
    const alertKinds = new Set([
      "provider_limit_spike",
      "provider_requires_login",
      "provider_expired",
      "provider_manual_action",
      "provider_ui_changed",
      "no_usable_models"
    ]);
    const toMaterialize = notifications.filter(n => alertKinds.has(n.kind));
    if (toMaterialize.length > 0) {
      // Run materialization in background or wait, depending on preference.
      // Awaiting here ensures read operations safely deduce their unread counts.
      await materializeNotificationEvents(userId, toMaterialize);
    }
  }

  return notifications;
}

function buildProviderLimitSpikeNotification(input: {
  provider: ProviderId;
  hits: number;
  threshold: number;
}): WorkspaceNotification {
  const providerName = providerDisplayNames[input.provider] ?? input.provider;
  const bucket = Math.floor(input.hits / input.threshold);
  return {
    id: `provider_limit_spike_${input.provider}`,
    severity: "warning",
    kind: "provider_limit_spike",
    title: `${providerName} is hitting its provider limit`,
    message: `${providerName} hit its provider limit ${input.hits} times in the last 24h.`,
    provider: input.provider,
    action: {
      label: "Review provider limits",
      href: "/settings/provider-rate-limits"
    },
    dismissible: true,
    fingerprint: `provider_limit_spike:${input.provider}:24h:bucket:${bucket}:threshold:${input.threshold}`,
    createdFromStatusAt: null
  };
}

function buildProviderNotification(health: ProviderHealth, modelId: string): WorkspaceNotification | null {
  const status = health.healthStatus === "healthy" ? health.connectionStatus : health.healthStatus;
  const providerName = providerDisplayNames[health.provider] ?? health.displayName;
  const statusAt = health.lastValidatedAt ?? health.lastConnectedAt ?? null;

  if (status === "requires_login" || health.connectionStatus === "requires_login") {
    return providerNotification({
      provider: health.provider,
      providerName,
      modelId,
      kind: "provider_requires_login",
      title: `${providerName} needs reconnect`,
      message: `Your ${providerName} session needs reconnect. Reconnect it to use ${modelId}.`,
      severity: "warning",
      statusAt
    });
  }

  if (status === "expired" || health.connectionStatus === "expired") {
    return providerNotification({
      provider: health.provider,
      providerName,
      modelId,
      kind: "provider_expired",
      title: `${providerName} session expired`,
      message: `Your ${providerName} session appears to be expired. Reconnect it to use ${modelId}.`,
      severity: "warning",
      statusAt
    });
  }

  if (status === "manual_action_required" || health.connectionStatus === "manual_action_required") {
    return providerNotification({
      provider: health.provider,
      providerName,
      modelId,
      kind: "provider_manual_action",
      title: `${providerName} needs manual action`,
      message: `Your ${providerName} session needs login verification before ${modelId} can be used.`,
      severity: "warning",
      statusAt
    });
  }

  if (isUiChanged(health)) {
    return providerNotification({
      provider: health.provider,
      providerName,
      modelId,
      kind: "provider_ui_changed",
      title: `${providerName} UI changed`,
      message: `${providerName} may have changed its web UI. Open Provider Health before using ${modelId}.`,
      severity: "critical",
      statusAt,
      action: {
        label: "Open Provider Health",
        href: "/settings/provider-health"
      }
    });
  }

  if ((status === "error" || health.connectionStatus === "error") && !health.isUsable) {
    return providerNotification({
      provider: health.provider,
      providerName,
      modelId,
      kind: "provider_unusable",
      title: `${providerName} is unavailable`,
      message: `${providerName} is not currently usable. Reconnect or validate it before using ${modelId}.`,
      severity: "warning",
      statusAt
    });
  }

  return null;
}

function providerNotification(input: {
  provider: ProviderId;
  providerName: string;
  modelId: string;
  kind: WorkspaceNotification["kind"];
  title: string;
  message: string;
  severity: WorkspaceNotification["severity"];
  statusAt: string | null;
  action?: WorkspaceNotification["action"];
}): WorkspaceNotification {
  return {
    id: `${input.kind}_${input.provider}`,
    severity: input.severity,
    kind: input.kind,
    title: input.title,
    message: input.message,
    provider: input.provider,
    modelId: input.modelId,
    action: input.action ?? {
      label: "Reconnect",
      href: "/connections"
    },
    dismissible: true,
    fingerprint: `${input.kind}:${input.provider}:${input.statusAt ?? "unknown"}`,
    createdFromStatusAt: input.statusAt
  };
}

function isUiChanged(health: ProviderHealth) {
  return (
    health.healthStatus === "ui_changed" ||
    health.connectionStatus === "ui_changed" ||
    health.errorCode === "PROVIDER_UI_CHANGED"
  );
}
