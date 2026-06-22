import type { ProviderConnectionSummary, ProviderId, WorkspaceNotification, NotificationEventView, NotificationDeliveryPreferenceView, NotificationDeliveryAttemptView } from "@uaiw/shared/types/provider";

export type { WorkspaceNotification, NotificationEventView, NotificationDeliveryPreferenceView, NotificationDeliveryAttemptView };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export async function apiGetProviders(): Promise<{ providers: ProviderConnectionSummary[] }> {
  const response = await fetch(`${API_BASE_URL}/providers`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load providers");
  return response.json();
}

export async function connectProvider(provider: ProviderId) {
  const response = await fetch(`${API_BASE_URL}/providers/${provider}/connect/start`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to start connection");
  return response.json();
}

export async function getLiveSubModels() {
  const response = await fetch(`${API_BASE_URL}/v1/settings/models/live-sub-models`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load live sub-models");
  return response.json();
}

export async function refreshLiveSubModels(provider: ProviderId) {
  const response = await fetch(`${API_BASE_URL}/v1/settings/models/live-sub-models/${provider}/refresh`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || "Failed to refresh live sub-models");
  }
  return response.json();
}

export async function checkProviderConnectStatus(provider: ProviderId, connectSessionId: string) {
  const search = new URLSearchParams({ connectSessionId });
  const response = await fetch(`${API_BASE_URL}/providers/${provider}/connect/status?${search}`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to check connection status");
  return response.json();
}

export async function disconnectProvider(provider: ProviderId) {
  const response = await fetch(`${API_BASE_URL}/providers/${provider}/disconnect`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to disconnect provider");
  return response.json();
}

export async function sendChat(input: {
  providers: ProviderId[];
  prompt: string;
  threadId?: string;
  saveHistory: boolean;
}) {
  const endpoint = input.providers.length === 1 ? "/chat" : "/chat/multi";
  const body =
    input.providers.length === 1
      ? {
          provider: input.providers[0],
          threadId: input.threadId,
          prompt: input.prompt,
          saveHistory: input.saveHistory
        }
      : input;

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) throw new Error("Failed to create chat job");
  return response.json();
}

export async function postChat(input: {
  provider: ProviderId;
  prompt: string;
  threadId?: string;
  saveHistory: boolean;
}): Promise<{ jobId: string; threadId: string | null; streamUrl: string }> {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? "Failed to create chat job");
  }

  return response.json();
}

export async function postMultiChat(input: {
  providers: ProviderId[];
  prompt: string;
  threadId?: string;
  saveHistory: boolean;
}): Promise<{
  threadId: string | null;
  jobs: Array<{ provider: ProviderId; jobId: string; streamUrl: string }>;
  errors: Array<{ provider: string; errorCode: string; message: string }>;
}> {
  const response = await fetch(`${API_BASE_URL}/chat/multi`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify(input)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !payload.errors) {
    throw new Error(payload.message ?? "Failed to create comparison jobs");
  }
  return {
    threadId: payload.threadId ?? null,
    jobs: payload.jobs ?? [],
    errors: payload.errors ?? []
  };
}

export async function getChatJobStatus(jobId: string) {
  const response = await fetch(`${API_BASE_URL}/chat/${jobId}/status`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load job status");
  return response.json();
}

export async function cancelChatJob(jobId: string): Promise<{ jobId: string; status: "cancelled" }> {
  const response = await fetch(`${API_BASE_URL}/chat/${jobId}/cancel`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message ?? "Failed to cancel job");
  }
  return payload;
}

export async function retryChatJob(jobId: string): Promise<{
  jobId: string;
  retryOfJobId: string;
  threadId: string | null;
  streamUrl: string;
}> {
  const response = await fetch(`${API_BASE_URL}/chat/${jobId}/retry`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message ?? "Failed to retry job");
  }
  return payload;
}

export function streamUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

// -- Settings Overview --

export interface SettingsOverview {
  providers: {
    total: number;
    connected: number;
    usable: number;
    requiresLogin: number;
  };
  models: {
    total: number;
    enabled: number;
    usable: number;
    defaultModelId: string | null;
  };
  apiKeys: {
    active: number;
    revoked: number;
  };
  usage: {
    requests24h: number;
    failed24h: number;
    rateLimited24h: number;
    providerRateLimited24h: number;
    requests7d: number;
  };
  backups: {
    lastExportAt: string | null;
    tracked: boolean;
  };
  scheduler: {
    providerHealthEnabled: boolean;
  };
}

export async function getSettingsOverview(): Promise<SettingsOverview> {
  const response = await fetch(`${API_BASE_URL}/settings/overview`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load settings overview");
  return response.json();
}

export async function getWorkspaceNotifications(): Promise<{ notifications: WorkspaceNotification[]; unreadCount: number }> {
  const response = await fetch(`${API_BASE_URL}/settings/notifications`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load workspace notifications");
  return response.json();
}

// -- Notification Preferences --

export interface NotificationPreferences {
  notifyProviderSessionIssues: boolean;
  notifyNoUsableModels: boolean;
  notifyProviderLimitSpikes: boolean;
  providerLimitSpikeThreshold24h: number;
}

export async function getNotificationPreferences(): Promise<{ preferences: NotificationPreferences }> {
  const response = await fetch(`${API_BASE_URL}/settings/notification-preferences`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load notification preferences");
  return response.json();
}

export async function updateNotificationPreferences(
  input: Partial<NotificationPreferences>
): Promise<{ preferences: NotificationPreferences }> {
  const response = await fetch(`${API_BASE_URL}/settings/notification-preferences`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify(input)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? "Failed to update notification preferences");
  return payload;
}

// -- Notification Events (History) --

export async function getNotificationEvents(params?: {
  limit?: number;
  unreadOnly?: boolean;
  kind?: string;
}): Promise<{ events: NotificationEventView[]; unreadCount: number }> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.unreadOnly !== undefined) search.set("unreadOnly", String(params.unreadOnly));
  if (params?.kind) search.set("kind", params.kind);

  const response = await fetch(`${API_BASE_URL}/settings/notification-events?${search}`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load notification events");
  return response.json();
}

export async function markNotificationEventRead(id: string): Promise<{ event: NotificationEventView }> {
  const response = await fetch(`${API_BASE_URL}/settings/notification-events/${id}/read`, {
    method: "PATCH",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to mark notification as read");
  return response.json();
}

export async function markAllNotificationEventsRead(): Promise<{ updated: number }> {
  const response = await fetch(`${API_BASE_URL}/settings/notification-events/read-all`, {
    method: "PATCH",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to mark all notifications as read");
  return response.json();
}

export async function getNotificationDeliveryPreferences(): Promise<{ preferences: NotificationDeliveryPreferenceView[] }> {
  const response = await fetch(`${API_BASE_URL}/settings/notification-delivery/preferences`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to fetch delivery preferences");
  return response.json();
}

export async function updateNotificationDeliveryPreference(channel: string, enabled: boolean): Promise<NotificationDeliveryPreferenceView> {
  const response = await fetch(`${API_BASE_URL}/settings/notification-delivery/preferences/${channel}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-local-user-id": "local-user" },
    body: JSON.stringify({ enabled })
  });
  if (!response.ok) throw new Error("Failed to update delivery preference");
  return response.json();
}

export async function getNotificationDeliveryAttempts(params?: { limit?: number; notificationEventId?: string }): Promise<{ attempts: NotificationDeliveryAttemptView[] }> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.notificationEventId) search.set("notificationEventId", params.notificationEventId);

  const response = await fetch(`${API_BASE_URL}/settings/notification-delivery/attempts?${search}`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to fetch delivery attempts");
  return response.json();
}

export async function getWebhookDeliveryConfig(): Promise<NotificationDeliveryPreferenceView> {
  const response = await fetch(`${API_BASE_URL}/settings/notification-delivery/webhook`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to fetch webhook config");
  return response.json();
}

export async function updateWebhookDeliveryConfig(input: { enabled: boolean; url: string }): Promise<{ preference: NotificationDeliveryPreferenceView; newSecret: string | null }> {
  const response = await fetch(`${API_BASE_URL}/settings/notification-delivery/webhook`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-local-user-id": "local-user" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update webhook config");
  }
  return response.json();
}

export async function rotateWebhookSigningSecret(): Promise<{ preference: NotificationDeliveryPreferenceView; signingSecret: string }> {
  const response = await fetch(`${API_BASE_URL}/settings/notification-delivery/webhook/rotate-secret`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to rotate webhook secret");
  return response.json();
}

export async function testWebhookDelivery(): Promise<{ attempts: NotificationDeliveryAttemptView[] }> {
  const response = await fetch(`${API_BASE_URL}/settings/notification-delivery/webhook/test`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to test webhook");
  }
  return response.json();
}

export async function retryNotificationDeliveryAttempt(id: string): Promise<{ queued: true; jobId: string; notificationEventId: string }> {
  const response = await fetch(`${API_BASE_URL}/settings/notification-delivery/attempts/${id}/retry`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to retry delivery attempt");
  }
  return response.json();
}

// -- Provider Rate Limits --

export interface ProviderRateLimitView {
  provider: ProviderId;
  requestsPerMinute: number | null;
  effectiveRequestsPerMinute: number;
  source: "env" | "custom";
  enabled: boolean;
}

export async function getProviderRateLimits(): Promise<{
  limits: ProviderRateLimitView[];
  maxRequestsPerMinute: number;
}> {
  const response = await fetch(`${API_BASE_URL}/settings/provider-rate-limits`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load provider rate limits");
  return response.json();
}

export async function updateProviderRateLimit(
  provider: ProviderId,
  requestsPerMinute: number | null
): Promise<{ limit: ProviderRateLimitView }> {
  const response = await fetch(`${API_BASE_URL}/settings/provider-rate-limits/${provider}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({ requestsPerMinute })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? "Failed to update provider rate limit");
  return payload;
}

// -- Onboarding --

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

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const response = await fetch(`${API_BASE_URL}/settings/onboarding`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load onboarding status");
  return response.json();
}

export async function updateOnboardingStatus(input: {
  lastStep?: string | null;
  completed?: boolean;
  skipped?: boolean;
}): Promise<OnboardingStatus> {
  const response = await fetch(`${API_BASE_URL}/settings/onboarding`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error("Failed to update onboarding status");
  return response.json();
}

export function markOnboardingComplete() {
  return updateOnboardingStatus({ completed: true });
}

export function skipOnboarding() {
  return updateOnboardingStatus({ skipped: true });
}

export async function testOpenAIModelsEndpoint(rawKey: string) {
  const response = await fetch(`${API_BASE_URL}/v1/models`, {
    headers: {
      Authorization: `Bearer ${rawKey}`
    },
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Failed to test /v1/models");
  }
  return payload;
}

// -- API Key Management --

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  keyLast4: string;
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  rotatedAt?: string | null;
  scopeMode: "all_enabled_models" | "restricted";
  allowedModels: string[];
  rateLimitPerMinute?: number | null;
  effectiveRateLimitPerMinute: number;
}

export async function apiGetApiKeys(): Promise<{ keys: ApiKey[] }> {
  const response = await fetch(`${API_BASE_URL}/settings/api-keys`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to get API keys");
  return response.json();
}

export async function apiCreateApiKey(name: string, allowedModelIds?: string[], rateLimitPerMinute?: number | null): Promise<{ key: ApiKey; rawKey: string }> {
  const response = await fetch(`${API_BASE_URL}/settings/api-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({ name, allowedModelIds, rateLimitPerMinute })
  });
  if (!response.ok) throw new Error("Failed to create API key");
  return response.json();
}

export async function revokeApiKey(id: string): Promise<{ ok: boolean }> {
  const response = await fetch(`${API_BASE_URL}/settings/api-keys/${id}/revoke`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to revoke API key");
  return response.json();
}

export async function apiRotateApiKey(id: string, preserveScopes: boolean = true): Promise<{ key: ApiKey; rawKey: string }> {
  const response = await fetch(`${API_BASE_URL}/settings/api-keys/${id}/rotate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({ preserveScopes })
  });
  if (!response.ok) throw new Error("Failed to rotate API key");
  return response.json();
}

export async function apiUpdateApiKeyScopes(id: string, allowedModelIds: string[]): Promise<{ key: ApiKey }> {
  const response = await fetch(`${API_BASE_URL}/settings/api-keys/${id}/scopes`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({ allowedModelIds })
  });
  if (!response.ok) throw new Error("Failed to update API key scopes");
  return response.json();
}

export async function apiUpdateApiKeyRateLimit(id: string, rateLimitPerMinute: number | null): Promise<{ key: ApiKey }> {
  const response = await fetch(`${API_BASE_URL}/settings/api-keys/${id}/rate-limit`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({ rateLimitPerMinute })
  });
  if (!response.ok) throw new Error("Failed to update API key rate limit");
  return response.json();
}
// -- API Usage Analytics --

export interface ApiUsageSummary {
  totals: {
    requests: number;
    completed: number;
    failed: number;
    rateLimited: number;
    inputChars: number;
    outputChars: number;
    avgDurationMs: number;
  };
  byModel: Array<{ model: string; requests: number; completed: number; failed: number }>;
  byProvider: Array<{ provider: string; requests: number; completed: number; failed: number }>;
}

export interface ApiUsageLog {
  id: string;
  createdAt: string;
  apiKeyId?: string | null;
  apiKeyPrefix?: string | null;
  model: string;
  provider: string;
  source?: UsageTrafficSource | null;
  status: string;
  errorCode?: string | null;
  stream: boolean;
  messageCount: number;
  inputCharCount: number;
  outputCharCount?: number | null;
  durationMs?: number | null;
}

export interface PaginatedApiUsageLogs {
  items: ApiUsageLog[];
  page: number;
  pageSize: number;
  total: number;
}

export type UsageTrafficSource =
  | "openai_compat"
  | "internal_chat"
  | "internal_multi_chat"
  | "internal_retry";

export interface ProviderLimitAnalyticsSummary {
  range: "24h" | "7d" | "custom";
  from: string;
  to: string;
  totalHits: number;
  byProvider: Array<{ provider: ProviderId; hits: number }>;
  byModel: Array<{ modelId: string; provider: ProviderId; hits: number }>;
  byApiKey: Array<{ apiKeyId: string; name: string; keyPrefix?: string | null; hits: number }>;
  bySource: Array<{ source: UsageTrafficSource; hits: number }>;
  recentEvents: Array<{
    createdAt: string;
    provider: ProviderId;
    modelId?: string | null;
    apiKeyName?: string | null;
    source?: UsageTrafficSource | null;
    errorCode: "provider_rate_limit_exceeded";
  }>;
}

export async function getApiUsageSummary(filters?: Record<string, any>): Promise<ApiUsageSummary> {
  const params = new URLSearchParams(filters || {});
  const response = await fetch(`${API_BASE_URL}/settings/api-usage/summary?${params}`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to get API usage summary");
  return response.json();
}

export async function getApiUsageLogs(filters?: Record<string, any>): Promise<PaginatedApiUsageLogs> {
  const params = new URLSearchParams(filters || {});
  const response = await fetch(`${API_BASE_URL}/settings/api-usage/logs?${params}`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to get API usage logs");
  return response.json();
}

export async function getProviderLimitAnalytics(range: "24h" | "7d" = "24h"): Promise<{ summary: ProviderLimitAnalyticsSummary }> {
  const params = new URLSearchParams({ range });
  const response = await fetch(`${API_BASE_URL}/settings/api-usage/provider-limits?${params}`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load provider limit analytics");
  return response.json();
}
// -- Provider Health Analytics --

export interface ProviderHealth {
  provider: string;
  displayName: string;
  readiness: string;
  capabilities: string[];
  connectionStatus: string;
  healthStatus: string;
  requiresLogin: boolean;
  isUsable: boolean;
  lastConnectedAt?: string | null;
  lastValidatedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export async function getProviderHealth(): Promise<{ data: ProviderHealth[] }> {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to get provider health");
  return response.json();
}

export async function refreshProviderHealth(provider: string): Promise<ProviderHealth> {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/${provider}/refresh`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to refresh provider health");
  return response.json();
}

export async function refreshAllProviderHealth(): Promise<{ data: ProviderHealth[] }> {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/refresh-all`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to refresh all provider health");
  return response.json();
}

// -- Model Preferences --

export interface ModelPreferenceView {
  modelId: string;
  provider: string;
  displayName: string;
  enabled: boolean;
  isDefault: boolean;
  priority: number;
  readiness: string;
  healthStatus: string;
  isUsable: boolean;
  requiresLogin: boolean;
  capabilities: string[];
  subModels?: Array<{ id: string; label: string; available?: boolean | "detect" }>;
  selectedSubModelId?: string | null;
}

export interface ModelPreferencesResponse {
  models: ModelPreferenceView[];
  autoSelectFirstUsable: boolean;
}

export async function apiGetModelPreferences(): Promise<ModelPreferencesResponse> {
  const response = await fetch(`${API_BASE_URL}/settings/models`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to get model preferences");
  return response.json();
}

export async function apiUpdateModelPreferences(input: {
  autoSelectFirstUsable: boolean;
  models: Array<{
    modelId: string;
    enabled: boolean;
    isDefault: boolean;
    priority: number;
    selectedSubModelId?: string | null;
  }>;
}): Promise<ModelPreferencesResponse> {
  const response = await fetch(`${API_BASE_URL}/settings/models`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error("Failed to update model preferences");
  return response.json();
}

// -- Conversation Export / Import --

export async function apiExportAllConversations() {
  const response = await fetch(`${API_BASE_URL}/settings/conversations/export`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to export conversations");
  const blob = await response.blob();
  return blob;
}

export async function apiExportThread(threadId: string) {
  const response = await fetch(`${API_BASE_URL}/settings/conversations/${threadId}/export`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to export thread");
  const blob = await response.blob();
  return blob;
}

export async function apiPreviewConversationImport(fileData: any) {
  const response = await fetch(`${API_BASE_URL}/settings/conversations/import/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({ file: fileData })
  });
  if (!response.ok) throw new Error("Failed to preview import");
  return response.json();
}

export async function apiImportConversations(fileData: any, conflictStrategy: "create_new" | "skip_duplicates" = "create_new") {
  const response = await fetch(`${API_BASE_URL}/settings/conversations/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({
      file: fileData,
      options: { conflictStrategy }
    })
  });
  if (!response.ok) {
    const errObj = await response.json().catch(() => ({}));
    throw new Error(errObj.error || "Failed to import conversations");
  }
  return response.json();
}

export async function exportEncryptedConversations(passphrase: string, threadId?: string) {
  const response = await fetch(`${API_BASE_URL}/settings/conversations/export/encrypted`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({ passphrase, threadId })
  });
  if (!response.ok) throw new Error("Failed to export encrypted conversations");
  const blob = await response.blob();
  return blob;
}

export async function previewEncryptedConversationImport(fileData: any, passphrase: string) {
  const response = await fetch(`${API_BASE_URL}/settings/conversations/import/encrypted/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({ file: fileData, passphrase })
  });
  if (!response.ok) {
    const errObj = await response.json().catch(() => ({}));
    throw new Error(errObj.error || "Failed to preview encrypted import");
  }
  return response.json();
}

export async function importEncryptedConversations(fileData: any, passphrase: string, conflictStrategy: "create_new" | "skip_duplicates" = "create_new") {
  const response = await fetch(`${API_BASE_URL}/settings/conversations/import/encrypted`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({
      file: fileData,
      passphrase,
      options: { conflictStrategy }
    })
  });
  if (!response.ok) {
    const errObj = await response.json().catch(() => ({}));
    throw new Error(errObj.error || "Failed to import encrypted conversations");
  }
  return response.json();
}
