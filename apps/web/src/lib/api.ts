import type { ProviderConnectionSummary, ProviderId, WorkspaceNotification, NotificationEventView } from "@uaiw/shared/types/provider";

export type { WorkspaceNotification, NotificationEventView };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export type WorkspacePermission =
  | "settings.read"
  | "apiKeys.read"
  | "apiKeys.write"
  | "providerConnections.read"
  | "providerConnections.write"
  | "providerDiagnostics.read"
  | "providerDiagnostics.action"
  | "notifications.read"
  | "notifications.write"
  | "usage.read"
  | "models.read"
  | "models.write"
  | "release.read"
  | "users.read"
  | "users.manageRoles";

export const permissionDeniedMessage = "You don't have permission to perform this action.";

export function hasPermission(permissions: readonly string[] | undefined, permission: WorkspacePermission) {
  return Boolean(permissions?.includes(permission));
}

async function parseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({}));
  if (response.status === 403 && payload.error === "permission_denied") return permissionDeniedMessage;
  return payload.message ?? payload.error ?? fallback;
}

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

export interface ChatAttachmentView {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export async function uploadChatAttachment(file: File): Promise<ChatAttachmentView> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const contentBase64 = btoa(binary);

  const response = await fetch(`${API_BASE_URL}/chat/uploads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      contentBase64
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? "Failed to upload attachment");
  }
  return response.json();
}

export async function postChat(input: {
  provider: ProviderId;
  prompt: string;
  threadId?: string;
  saveHistory: boolean;
  attachmentIds?: string[];
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
  attachmentIds?: string[];
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
  currentUser: {
    id: string;
    role: WorkspaceRole;
    permissions: WorkspacePermission[];
  };
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

export interface ManagedUser {
  id: string;
  email: string | null;
  name: string | null;
  role: WorkspaceRole;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserRoleAuditEvent {
  id: string;
  actorUserId: string;
  targetUserId: string | null;
  previousRole: WorkspaceRole | null;
  nextRole: WorkspaceRole | null;
  previousStatus: string | null;
  nextStatus: string | null;
  inviteId: string | null;
  action: string;
  createdAt: string;
}

export async function getManagedUsers(): Promise<{ users: ManagedUser[] }> {
  const response = await fetch(`${API_BASE_URL}/settings/users`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to load users"));
  return response.json();
}

export interface WorkspaceInvite {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: string;
  expiresAt: string;
  createdAt: string;
  latestDelivery?: {
    channel: string;
    status: string;
    createdAt: string;
  };
}

export interface WorkspaceInviteEmailPreview {
  subject: string;
  text: string;
  html?: string;
}

export interface WorkspaceInviteEmailDeliveryStatus {
  enabled: boolean;
  provider: "noop" | "console_dry_run" | "smtp";
  dryRun: boolean;
  allowRealSend: boolean;
  canAttemptSend: boolean;
  realSendPossible: boolean;
  missingRequiredConfig: string[];
  warnings: string[];
  fromConfigured: boolean;
  baseUrlConfigured: boolean;
}

export interface CreateWorkspaceInviteResult {
  invite: WorkspaceInvite;
  token: string;
  inviteUrl?: string;
  emailPreview?: WorkspaceInviteEmailPreview;
  delivery: {
    channel: string;
    status: string;
  };
}

export async function listWorkspaceInvites(): Promise<{ invites: WorkspaceInvite[] }> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/invites`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to load invites"));
  return response.json();
}

export async function createWorkspaceInvite(input: { email: string; role: WorkspaceRole }): Promise<CreateWorkspaceInviteResult> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/invites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to create invite"));
  return response.json();
}

export async function previewWorkspaceInvite(input: {
  email: string;
  role: WorkspaceRole;
  expiresInDays?: number;
}): Promise<{ emailPreview: WorkspaceInviteEmailPreview }> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/invites/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to generate invite preview"));
  return response.json();
}

export async function revokeWorkspaceInvite(inviteId: string): Promise<WorkspaceInvite> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/invites/${inviteId}/revoke`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to revoke invite"));
  const data = await response.json();
  return data.invite;
}

export async function acceptWorkspaceInvite(token: string): Promise<{ workspaceId: string }> {
  const response = await fetch(`${API_BASE_URL}/workspace/invites/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({ token })
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to accept invite"));
  return response.json();
}

export interface WorkspaceInviteDeliveryAttempt {
  id: string;
  channel: string;
  provider: string;
  status: string;
  recipientEmailRedacted?: string;
  reason?: string;
  createdAt: string;
}

export async function getWorkspaceInviteDeliveryAttempts(inviteId: string): Promise<{ attempts: WorkspaceInviteDeliveryAttempt[] }> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/invites/${inviteId}/delivery-attempts`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to get delivery attempts"));
  return response.json();
}

export async function sendWorkspaceInviteDeliveryTest(input: {
  email?: string;
  allowRealSendTest?: boolean;
}): Promise<{ status: string; provider: string; testSubject?: string; error?: string }> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/invites/email-delivery-test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to run delivery test"));
  return response.json();
}

export async function updateManagedUserRole(input: {
  userId: string;
  role: WorkspaceRole;
  confirmSelfDemotion?: boolean;
}): Promise<{ user: ManagedUser }> {
  const response = await fetch(`${API_BASE_URL}/settings/users/${input.userId}/role`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({
      role: input.role,
      confirmSelfDemotion: input.confirmSelfDemotion
    })
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to update role"));
  return response.json();
}

export async function updateMembershipStatus(input: {
  userId: string;
  status: "active" | "disabled";
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/settings/users/${input.userId}/membership`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({ status: input.status })
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to update membership status"));
}

export async function getWorkspaceAuditEvents(limit = 50): Promise<{ events: UserRoleAuditEvent[] }> {
  const query = new URLSearchParams({ limit: String(limit) });
  const response = await fetch(`${API_BASE_URL}/settings/workspace/audit?${query.toString()}`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to load workspace audit"));
  return response.json();
}

export interface SchedulerStatusView {
  name: string;
  enabled: boolean;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastStatus?: "running" | "success" | "failed" | "skipped" | "disabled";
  lastError?: string;
  lastLockAcquired?: boolean;
  lastSummary?: {
    scanned?: number;
    expired?: number;
    skipped?: number;
    dryRun?: boolean;
    durationMs?: number;
    lock?: "acquired" | "skipped" | "unavailable";
    source?: "scheduler" | "cli";
  };
  runCount: number;
  failureCount: number;
  skippedCount: number;
  updatedAt?: string;
}

export async function getWorkspaceInviteExpirySchedulerStatus(): Promise<SchedulerStatusView> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/invites/scheduler-status`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to get invite expiry scheduler status");
  return response.json();
}

export async function getWorkspaceInviteEmailDeliveryStatus(): Promise<WorkspaceInviteEmailDeliveryStatus> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/invites/email-delivery-status`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to get email delivery status"));
  return response.json();
}

// -- Workspace --

export interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  currentUser: {
    id: string;
    role: string;
    permissions: string[];
  };
}

export async function getWorkspaceInfo(): Promise<WorkspaceInfo> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load workspace info");
  return response.json();
}

export interface WorkspaceMembershipInfo {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  membershipId: string;
}

export async function getWorkspaces(): Promise<{ currentWorkspaceId: string; workspaces: WorkspaceMembershipInfo[] }> {
  const response = await fetch(`${API_BASE_URL}/settings/workspaces`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load workspaces");
  return response.json();
}

export async function switchWorkspace(workspaceId: string): Promise<{ currentWorkspaceId: string; role: WorkspaceRole; permissions: WorkspacePermission[] }> {
  const response = await fetch(`${API_BASE_URL}/settings/workspaces/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-local-user-id": "local-user" },
    body: JSON.stringify({ workspaceId })
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to switch workspace"));
  return response.json();
}

export async function createWorkspace(name: string): Promise<{ workspace: WorkspaceMembershipInfo; currentWorkspaceId: string }> {
  const response = await fetch(`${API_BASE_URL}/settings/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-local-user-id": "local-user" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to create workspace"));
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

export async function getProviderHealthIncidentRunbook(id: string): Promise<{ data: any }> {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/incidents/${id}/runbook`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to get incident runbook");
  return response.json();
}

export async function runProviderHealthAction(incidentId: string, action: "health-check" | "ui-diagnostics") {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/incidents/${incidentId}/actions/${action}`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to run ${action}`);
  }
  return response.json();
}

export async function listProviderDiagnosticsRuns(params: { provider?: string; incidentId?: string; status?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params.provider) query.set("provider", params.provider);
  if (params.incidentId) query.set("incidentId", params.incidentId);
  if (params.status) query.set("status", params.status);
  if (params.limit) query.set("limit", params.limit.toString());
  
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/diagnostics-runs?${query.toString()}`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to list diagnostics runs");
  return response.json();
}

export async function getProviderDiagnosticsRunDetail(id: string) {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/diagnostics-runs/${id}`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to get diagnostics run detail");
  return response.json();
}

export async function diffProviderDiagnosticsRuns(leftId: string, rightId: string) {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/diagnostics-runs/${leftId}/diff/${rightId}`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to diff diagnostics runs");
  return response.json();
}

export async function executeProviderAction(endpoint: string, method: string): Promise<{ data?: any }> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: { "x-local-user-id": "local-user" }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Failed to execute action");
  return data;
}

// -- Provider Diagnostics Baselines & Drift Alerts --

export async function listProviderDiagnosticsBaselines(params: { provider?: string; isActive?: boolean; limit?: number }) {
  const query = new URLSearchParams();
  if (params.provider) query.set("provider", params.provider);
  if (params.isActive !== undefined) query.set("isActive", String(params.isActive));
  if (params.limit) query.set("limit", params.limit.toString());

  const response = await fetch(`${API_BASE_URL}/settings/provider-health/diagnostics-baselines?${query.toString()}`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to list baselines");
  return response.json();
}

export async function setProviderDiagnosticsBaseline(runId: string, name: string, setActive: boolean = true) {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/diagnostics-runs/${runId}/set-baseline`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-local-user-id": "local-user" },
    body: JSON.stringify({ name, setActive })
  });
  if (!response.ok) throw new Error("Failed to set baseline");
  return response.json();
}

export async function deactivateProviderDiagnosticsBaseline(baselineId: string) {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/diagnostics-baselines/${baselineId}/deactivate`, {
    method: "POST",
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to deactivate baseline");
  return response.json();
}

export async function evaluateProviderDiagnosticsDrift(runId: string, persist: boolean = false) {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/diagnostics-runs/${runId}/evaluate-drift`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-local-user-id": "local-user" },
    body: JSON.stringify({ persist })
  });
  if (!response.ok) throw new Error("Failed to evaluate drift");
  return response.json();
}

export async function listProviderDiagnosticsDriftAlerts(params: { provider?: string; status?: string; severity?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params.provider) query.set("provider", params.provider);
  if (params.status) query.set("status", params.status);
  if (params.severity) query.set("severity", params.severity);
  if (params.limit) query.set("limit", params.limit.toString());

  const response = await fetch(`${API_BASE_URL}/settings/provider-health/diagnostics-drift-alerts?${query.toString()}`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to list drift alerts");
  return response.json();
}

export async function getProviderDiagnosticsDriftAlertDetail(alertId: string) {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/diagnostics-drift-alerts/${alertId}`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to get drift alert detail");
  return response.json();
}

export async function resolveProviderDiagnosticsDriftAlert(alertId: string, resolution: "accepted_change" | "fixed" | "ignored", note?: string) {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/diagnostics-drift-alerts/${alertId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-local-user-id": "local-user" },
    body: JSON.stringify({ resolution, note })
  });
  if (!response.ok) throw new Error("Failed to resolve alert");
  return response.json();
}

export interface WorkspaceQuotaAlertSchedulerStatus {
  enabled: boolean;
  intervalSeconds: number;
  maxWorkspacesPerRun: number;
  lockTtlSeconds: number;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastStatus?: string;
  lastSummary?: {
    scannedWorkspaces?: number;
    warningsCreated?: number;
    exceededCreated?: number;
    skipped?: number;
    lock?: string;
    source?: "scheduler" | "cli";
  } | null;
  runCount: number;
  failureCount: number;
  skippedCount: number;
}

export async function getWorkspaceQuotaAlertSchedulerStatus(): Promise<WorkspaceQuotaAlertSchedulerStatus> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/quota/alert-scheduler-status`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to load workspace quota alert scheduler status");
  return response.json();
}

// -- Notification Preferences --

export interface NotificationPreferences {
  notifyProviderSessionIssues: boolean;
  notifyNoUsableModels: boolean;
  notifyProviderLimitSpikes: boolean;
  providerLimitSpikeThreshold24h: number;
  notifyWorkspaceQuotaWarnings: boolean;
  notifyWorkspaceQuotaExceeded: boolean;
  workspaceQuotaWarningThresholdPercent: number;
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

// -- Provider Health Incidents --

export interface ProviderHealthIncidentView {
  id: string;
  provider: string;
  connectionId?: string;
  status: string;
  previousStatus?: string;
  severity: "info" | "warning" | "error" | "critical";
  reason?: string;
  startedAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  occurrenceCount: number;
  notificationEventId?: string;
  metadata?: any;
}

export async function getProviderHealthIncidents(filters?: {
  provider?: string;
  status?: string;
  severity?: string;
  limit?: number;
}): Promise<{ data: ProviderHealthIncidentView[] }> {
  const query = new URLSearchParams();
  if (filters?.provider) query.set("provider", filters.provider);
  if (filters?.status) query.set("status", filters.status);
  if (filters?.severity) query.set("severity", filters.severity);
  if (filters?.limit) query.set("limit", filters.limit.toString());

  const response = await fetch(`${API_BASE_URL}/settings/provider-health/incidents?${query.toString()}`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to get provider health incidents");
  return response.json();
}

export async function resolveProviderHealthIncident(id: string, resolution: string, note?: string): Promise<{ success: boolean; resolvedAt: string }> {
  const response = await fetch(`${API_BASE_URL}/settings/provider-health/incidents/${id}/resolve`, {
    method: "POST",
    headers: {
      "x-local-user-id": "local-user",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ resolution, note })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to resolve incident");
  }
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

export type WorkspaceQuotaResource =
  | "members"
  | "pendingInvites"
  | "apiKeys"
  | "providerConnections"
  | "diagnosticsBaselines"
  | "monthlyApiRequests"
  | "monthlyInviteEmails";

export interface WorkspaceQuotaStatus {
  resource: WorkspaceQuotaResource;
  limit: number | null;
  used: number;
  remaining: number | null;
  exceeded: boolean;
}

export interface WorkspaceUsageSummary {
  plan: string;
  quotas: WorkspaceQuotaStatus[];
}

export interface WorkspaceQuotaEvent {
  id: string;
  resource: string;
  source: string;
  limit: number | null;
  used: number;
  attemptedIncrement: number;
  createdAt: string;
}

export interface UpdateQuotaPatch {
  maxMembers?: number | null;
  maxInvites?: number | null;
  maxApiKeys?: number | null;
  maxProviderConnections?: number | null;
  maxDiagnosticsBaselines?: number | null;
  maxMonthlyApiRequests?: number | null;
  maxMonthlyInviteEmails?: number | null;
}

export async function getWorkspaceQuotaSummary(): Promise<WorkspaceUsageSummary> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/quota`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to load quota summary"));
  }
  return response.json();
}

export async function updateWorkspaceQuota(patch: UpdateQuotaPatch): Promise<WorkspaceUsageSummary> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/quota`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error("Failed to update workspace quota");
  return response.json();
}

export interface WorkspaceQuotaReport {
  workspace: { id: string; name: string; slug?: string };
  range: "24h" | "7d" | "30d" | "90d";
  generatedAt: string;
  quotas: Array<{
    resource: string;
    limit: number | null;
    used: number;
    remaining: number | null;
    exceeded: boolean;
  }>;
  eventsByResource: Array<{ resource: string; count: number }>;
  eventsBySource: Array<{ source: string; count: number }>;
  recentEvents: Array<{
    resource: string;
    source: string;
    limit: number | null;
    used: number;
    attemptedIncrement: number;
    createdAt: string;
  }>;
}

export async function getWorkspaceQuotaReport(range: "24h" | "7d" | "30d" | "90d"): Promise<WorkspaceQuotaReport> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/quota/report?range=${range}`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to load workspace quota report");
  return response.json();
}

export function getWorkspaceQuotaReportDownloadUrl(range: "24h" | "7d" | "30d" | "90d"): string {
  return `${API_BASE_URL}/settings/workspace/quota/report/download?range=${range}`;
}

export interface QuotaPreset {
  label: string;
  description?: string;
  quotas: Record<string, number | null>;
}

export async function getWorkspaceQuotaPresets(): Promise<{ presets: Record<string, QuotaPreset> }> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/quota/presets`, {
    headers: { "x-local-user-id": "local-user" }
  });
  if (!response.ok) throw new Error("Failed to load workspace quota presets");
  return response.json();
}

export async function applyWorkspaceQuotaPreset(preset: string, confirmExceeded?: boolean): Promise<{ success: boolean; warning?: string; exceededResources?: any[] }> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/quota/presets/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-local-user-id": "local-user"
    },
    body: JSON.stringify({ preset, confirmExceeded })
  });
  
  if (!response.ok && response.status === 400) {
    const errorData = await response.json().catch(() => null);
    if (errorData?.error === "quota_preset_would_exceed_usage") {
      throw { ...errorData, isExceededWarning: true };
    }
  }
  
  if (!response.ok) throw new Error("Failed to apply workspace quota preset");
  return response.json();
}

export async function getWorkspaceQuotaEvents(params?: { resource?: string; limit?: number }): Promise<{ events: WorkspaceQuotaEvent[] }> {
  const url = new URL(`${API_BASE_URL}/settings/workspace/quota/events`);
  if (params?.resource) url.searchParams.set("resource", params.resource);
  if (params?.limit) url.searchParams.set("limit", String(params.limit));

  const response = await fetch(url.toString(), {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to load quota events"));
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Workspace Activity Timeline
// ---------------------------------------------------------------------------

export type ActivityCategory =
  | "membership" | "invite" | "invite_delivery" | "quota" | "notification"
  | "scheduler" | "provider_health" | "diagnostics" | "recovery" | "webhook" | "api_usage";

export interface ActivityEvent {
  id: string;
  category: ActivityCategory;
  action: string;
  severity?: "info" | "warning" | "error" | "critical";
  title: string;
  summary: string;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
}

export interface ActivityTimelineResponse {
  events: ActivityEvent[];
  nextCursor?: string;
}

export async function getWorkspaceActivity(params?: {
  range?: string;
  category?: string;
  limit?: number;
  cursor?: string;
}): Promise<ActivityTimelineResponse> {
  const url = new URL(`${API_BASE_URL}/settings/workspace/activity`);
  if (params?.range) url.searchParams.set("range", params.range);
  if (params?.category) url.searchParams.set("category", params.category);
  if (params?.limit) url.searchParams.set("limit", String(params.limit));
  if (params?.cursor) url.searchParams.set("cursor", params.cursor);

  const response = await fetch(url.toString(), {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to load activity"));
  return response.json();
}

// ---------------------------------------------------------------------------
// Workspace Admin Overview
// ---------------------------------------------------------------------------

export interface WorkspaceAdminOverview {
  workspace: { id: string; name: string; slug?: string };
  members: { active: number; disabled: number; pendingInvites: number };
  quotas: { exceeded: number; nearLimit: number };
  schedulers: Array<{ name: string; enabled: boolean; lastStatus?: string; lastFinishedAt?: string }>;
  notifications: { unread: number; criticalRecent: number };
  providers: { usable: number; requiresAttention: number };
  emailDelivery: { enabled: boolean; provider: string; dryRun: boolean; realSendPossible: boolean };
  diagnostics: { openDriftAlerts: number };
}

export async function getWorkspaceAdminOverview(): Promise<WorkspaceAdminOverview> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/admin-overview`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to load admin overview"));
  return response.json();
}

// ---------------------------------------------------------------------------
// Scheduler Fleet Status
// ---------------------------------------------------------------------------

export interface SchedulerFleetEntry {
  name: string;
  enabled: boolean;
  lastStatus?: string;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  runCount: number;
  failureCount: number;
  skippedCount: number;
  lastSummary?: Record<string, string | number | boolean | null>;
}

export async function getSchedulerFleetStatus(): Promise<{ schedulers: SchedulerFleetEntry[] }> {
  const response = await fetch(`${API_BASE_URL}/settings/workspace/schedulers`, {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to load scheduler status"));
  return response.json();
}

// ---------------------------------------------------------------------------
// Workspace Admin Export
// ---------------------------------------------------------------------------

export async function getWorkspaceAdminExport(range?: string): Promise<Record<string, unknown>> {
  const url = new URL(`${API_BASE_URL}/settings/workspace/admin-export`);
  if (range) url.searchParams.set("range", range);

  const response = await fetch(url.toString(), {
    headers: { "x-local-user-id": "local-user" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(await parseError(response, "Failed to load admin export"));
  return response.json();
}

export function getWorkspaceAdminExportDownloadUrl(range?: string): string {
  const url = new URL(`${API_BASE_URL}/settings/workspace/admin-export/download`);
  if (range) url.searchParams.set("range", range);
  return url.toString();
}
