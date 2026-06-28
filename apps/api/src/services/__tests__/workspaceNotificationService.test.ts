import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkspaceNotifications } from "../workspaceNotificationService.js";
import { getProviderLimitAnalytics } from "../apiUsageService.js";
import { getModelPreferences } from "../modelPreferenceService.js";
import { getNotificationPreferences } from "../notificationPreferenceService.js";
import { getProviderHealth } from "../providerHealthService.js";
import { materializeNotificationEvents } from "../notificationEventService.js";

vi.mock("../apiUsageService.js", () => ({
  getProviderLimitAnalytics: vi.fn()
}));

vi.mock("../modelPreferenceService.js", () => ({
  getModelPreferences: vi.fn()
}));

vi.mock("../notificationPreferenceService.js", () => ({
  getNotificationPreferences: vi.fn()
}));

vi.mock("../providerHealthService.js", () => ({
  getProviderHealth: vi.fn()
}));

vi.mock("../notificationEventService.js", () => ({
  materializeNotificationEvents: vi.fn().mockResolvedValue([])
}));

vi.mock("../providerHealthIncidentService.js", () => ({
  linkNotificationEvents: vi.fn().mockResolvedValue(undefined)
}));

const userId = "notifications-user";

const healthyProviders = [
  providerHealth("chatgpt", "healthy", true),
  providerHealth("gemini", "healthy", true),
  providerHealth("claude", "healthy", true)
];

const enabledModels = [
  modelPreference("chatgpt-web", "chatgpt", true, true),
  modelPreference("gemini-web", "gemini", true, true),
  modelPreference("claude-web", "claude", true, true)
];

const defaultNotificationPreferences = {
  notifyProviderSessionIssues: true,
  notifyNoUsableModels: true,
  notifyProviderLimitSpikes: true,
  providerLimitSpikeThreshold24h: 10,
  notifyWorkspaceQuotaWarnings: true,
  notifyWorkspaceQuotaExceeded: true,
  workspaceQuotaWarningThresholdPercent: 90
};

describe("workspaceNotificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNotificationPreferences).mockResolvedValue(defaultNotificationPreferences);
    vi.mocked(getProviderLimitAnalytics).mockResolvedValue(providerLimitAnalytics([
      { provider: "chatgpt", hits: 0 },
      { provider: "claude", hits: 0 },
      { provider: "gemini", hits: 0 }
    ]) as any);
  });

  it("returns no notifications for healthy connected providers", async () => {
    vi.mocked(getProviderHealth).mockResolvedValueOnce(healthyProviders as any);
    vi.mocked(getModelPreferences).mockResolvedValueOnce({ models: enabledModels as any, autoSelectFirstUsable: true });

    await expect(getWorkspaceNotifications(userId)).resolves.toEqual([]);
  });

  it("returns a warning notification for requires_login", async () => {
    vi.mocked(getProviderHealth).mockResolvedValueOnce([
      providerHealth("chatgpt", "requires_login", false, "2026-06-21T10:00:00.000Z")
    ] as any);
    vi.mocked(getModelPreferences).mockResolvedValueOnce({
      models: [modelPreference("chatgpt-web", "chatgpt", true, false)] as any,
      autoSelectFirstUsable: true
    });

    const notifications = await getWorkspaceNotifications(userId);
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          kind: "provider_requires_login",
          provider: "chatgpt",
          modelId: "chatgpt-web",
          fingerprint: "provider_requires_login:chatgpt:2026-06-21T10:00:00.000Z"
        })
      ])
    );
  });

  it("returns a warning notification for expired", async () => {
    vi.mocked(getProviderHealth).mockResolvedValueOnce([providerHealth("gemini", "expired", false)] as any);
    vi.mocked(getModelPreferences).mockResolvedValueOnce({
      models: [modelPreference("gemini-web", "gemini", true, false)] as any,
      autoSelectFirstUsable: true
    });

    const notifications = await getWorkspaceNotifications(userId);
    expect(notifications[0]).toMatchObject({
      severity: "warning",
      kind: "provider_expired",
      provider: "gemini"
    });
  });

  it("returns a critical notification for enabled provider UI changes", async () => {
    vi.mocked(getProviderHealth).mockResolvedValueOnce([
      { ...providerHealth("claude", "error", false), errorCode: "PROVIDER_UI_CHANGED" }
    ] as any);
    vi.mocked(getModelPreferences).mockResolvedValueOnce({
      models: [modelPreference("claude-web", "claude", true, false)] as any,
      autoSelectFirstUsable: true
    });

    const notifications = await getWorkspaceNotifications(userId);
    expect(notifications[0]).toMatchObject({
      severity: "critical",
      kind: "provider_ui_changed",
      action: { href: "/settings/provider-health" }
    });
  });

  it("does not produce provider notifications for disabled models", async () => {
    vi.mocked(getProviderHealth).mockResolvedValueOnce([providerHealth("chatgpt", "requires_login", false)] as any);
    vi.mocked(getModelPreferences).mockResolvedValueOnce({
      models: [
        modelPreference("chatgpt-web", "chatgpt", false, false),
        modelPreference("gemini-web", "gemini", true, true)
      ] as any,
      autoSelectFirstUsable: true
    });

    await expect(getWorkspaceNotifications(userId)).resolves.toEqual([]);
  });

  it("returns critical no_usable_models when enabled models cannot be used", async () => {
    vi.mocked(getProviderHealth).mockResolvedValueOnce([providerHealth("chatgpt", "requires_login", false)] as any);
    vi.mocked(getModelPreferences).mockResolvedValueOnce({
      models: [modelPreference("chatgpt-web", "chatgpt", true, false)] as any,
      autoSelectFirstUsable: true
    });

    const notifications = await getWorkspaceNotifications(userId);
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "critical",
          kind: "no_usable_models",
          dismissible: false
        })
      ])
    );
  });

  it("does not expose forbidden fields", async () => {
    vi.mocked(getProviderHealth).mockResolvedValueOnce([providerHealth("chatgpt", "expired", false)] as any);
    vi.mocked(getModelPreferences).mockResolvedValueOnce({
      models: [modelPreference("chatgpt-web", "chatgpt", true, false)] as any,
      autoSelectFirstUsable: true
    });

    const raw = JSON.stringify(await getWorkspaceNotifications(userId));
    for (const forbidden of ["cookie", "token", "localStorage", "storageState", "encryptedSessionBlob", "prompt", "response"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("hides provider session issues when disabled", async () => {
    vi.mocked(getNotificationPreferences).mockResolvedValueOnce({
      ...defaultNotificationPreferences,
      notifyProviderSessionIssues: false
    });
    vi.mocked(getProviderHealth).mockResolvedValueOnce([providerHealth("chatgpt", "requires_login", false)] as any);
    vi.mocked(getModelPreferences).mockResolvedValueOnce({
      models: [modelPreference("chatgpt-web", "chatgpt", true, false)] as any,
      autoSelectFirstUsable: true
    });

    const notifications = await getWorkspaceNotifications(userId);
    expect(notifications.some((notification) => notification.kind === "provider_requires_login")).toBe(false);
  });

  it("hides no usable models when disabled", async () => {
    vi.mocked(getNotificationPreferences).mockResolvedValueOnce({
      ...defaultNotificationPreferences,
      notifyNoUsableModels: false
    });
    vi.mocked(getProviderHealth).mockResolvedValueOnce([providerHealth("chatgpt", "requires_login", false)] as any);
    vi.mocked(getModelPreferences).mockResolvedValueOnce({
      models: [modelPreference("chatgpt-web", "chatgpt", true, false)] as any,
      autoSelectFirstUsable: true
    });

    const notifications = await getWorkspaceNotifications(userId);
    expect(notifications.some((notification) => notification.kind === "no_usable_models")).toBe(false);
  });

  it("shows provider limit spike when hits meet threshold", async () => {
    vi.mocked(getProviderHealth).mockResolvedValueOnce(healthyProviders as any);
    vi.mocked(getModelPreferences).mockResolvedValueOnce({ models: enabledModels as any, autoSelectFirstUsable: true });
    vi.mocked(getProviderLimitAnalytics).mockResolvedValueOnce(providerLimitAnalytics([
      { provider: "chatgpt", hits: 12 },
      { provider: "claude", hits: 0 },
      { provider: "gemini", hits: 0 }
    ]) as any);

    const notifications = await getWorkspaceNotifications(userId);
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "provider_limit_spike",
          provider: "chatgpt",
          message: "ChatGPT hit its provider limit 12 times in the last 24h.",
          fingerprint: "provider_limit_spike:chatgpt:24h:bucket:1:threshold:10"
        })
      ])
    );
  });

  it("hides provider limit spike below threshold or when disabled", async () => {
    vi.mocked(getProviderHealth).mockResolvedValue(healthyProviders as any);
    vi.mocked(getModelPreferences).mockResolvedValue({ models: enabledModels as any, autoSelectFirstUsable: true });
    vi.mocked(getProviderLimitAnalytics).mockResolvedValue(providerLimitAnalytics([
      { provider: "chatgpt", hits: 9 },
      { provider: "claude", hits: 0 },
      { provider: "gemini", hits: 0 }
    ]) as any);

    let notifications = await getWorkspaceNotifications(userId);
    expect(notifications.some((notification) => notification.kind === "provider_limit_spike")).toBe(false);

    vi.mocked(getNotificationPreferences).mockResolvedValueOnce({
      ...defaultNotificationPreferences,
      notifyProviderLimitSpikes: false
    });
    vi.mocked(getProviderLimitAnalytics).mockResolvedValueOnce(providerLimitAnalytics([
      { provider: "chatgpt", hits: 12 },
      { provider: "claude", hits: 0 },
      { provider: "gemini", hits: 0 }
    ]) as any);

    notifications = await getWorkspaceNotifications(userId);
    expect(notifications.some((notification) => notification.kind === "provider_limit_spike")).toBe(false);
  });

  it("keeps provider limit spike fingerprint stable within a threshold bucket", async () => {
    vi.mocked(getProviderHealth).mockResolvedValue(healthyProviders as any);
    vi.mocked(getModelPreferences).mockResolvedValue({ models: enabledModels as any, autoSelectFirstUsable: true });
    vi.mocked(getProviderLimitAnalytics).mockResolvedValueOnce(providerLimitAnalytics([
      { provider: "chatgpt", hits: 12 },
      { provider: "claude", hits: 0 },
      { provider: "gemini", hits: 0 }
    ]) as any);
    const first = await getWorkspaceNotifications(userId);

    vi.mocked(getProviderLimitAnalytics).mockResolvedValueOnce(providerLimitAnalytics([
      { provider: "chatgpt", hits: 19 },
      { provider: "claude", hits: 0 },
      { provider: "gemini", hits: 0 }
    ]) as any);
    const second = await getWorkspaceNotifications(userId);

    expect(first.find((item) => item.kind === "provider_limit_spike")?.fingerprint).toBe(
      second.find((item) => item.kind === "provider_limit_spike")?.fingerprint
    );
  });
});

function providerHealth(provider: string, status: string, isUsable: boolean, at = "2026-06-21T09:00:00.000Z") {
  return {
    provider,
    displayName: provider === "chatgpt" ? "ChatGPT" : provider === "gemini" ? "Gemini" : "Claude",
    readiness: "ready",
    capabilities: ["send_message"],
    connectionStatus: status === "healthy" ? "connected" : status,
    healthStatus: status,
    requiresLogin: status === "requires_login",
    isUsable,
    lastConnectedAt: at,
    lastValidatedAt: at,
    errorCode: null,
    errorMessage: null
  };
}

function modelPreference(modelId: string, provider: string, enabled: boolean, isUsable: boolean) {
  return {
    modelId,
    provider,
    displayName: modelId,
    enabled,
    isDefault: modelId === "chatgpt-web",
    priority: 10,
    readiness: "ready",
    healthStatus: isUsable ? "healthy" : "requires_login",
    isUsable,
    requiresLogin: !isUsable,
    capabilities: ["send_message"],
    subModels: [],
    selectedSubModelId: "current",
    selectedSubModelLabel: "Current / Provider default"
  };
}

function providerLimitAnalytics(byProvider: Array<{ provider: string; hits: number }>) {
  return {
    range: "24h",
    from: "2026-06-20T00:00:00.000Z",
    to: "2026-06-21T00:00:00.000Z",
    totalHits: byProvider.reduce((sum, item) => sum + item.hits, 0),
    byProvider,
    byModel: [],
    byApiKey: [],
    recentEvents: []
  };
}
