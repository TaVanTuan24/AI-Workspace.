export const PROVIDERS = ["chatgpt", "claude", "gemini"] as const;

export type ProviderId = (typeof PROVIDERS)[number];

export type ProviderStatus =
  | "not_connected"
  | "connecting"
  | "connected"
  | "requires_login"
  | "manual_action_required"
  | "expired"
  | "error"
  | "disconnected";

export type ProviderAuthStatus =
  | "connected"
  | "requires_login"
  | "manual_action_required"
  | "expired"
  | "error";

export type JobStatus =
  | "queued"
  | "running"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout"
  | "requires_login"
  | "manual_action_required";

export type ChatJobStatus = JobStatus;

export type ErrorCode =
  | "UNKNOWN_PROVIDER"
  | "PROVIDER_NOT_READY"
  | "PROVIDER_NOT_CONNECTED"
  | "PROVIDER_BUSY"
  | "JOB_NOT_FOUND"
  | "JOB_FORBIDDEN"
  | "JOB_NOT_CANCELLABLE"
  | "JOB_NOT_RETRYABLE"
  | "JOB_CANCELLED"
  | "JOB_TIMEOUT"
  | "WORKER_UNAVAILABLE"
  | "SESSION_EXPIRED"
  | "REQUIRES_LOGIN"
  | "MANUAL_ACTION_REQUIRED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_RATE_LIMIT_EXCEEDED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UI_CHANGED"
  | "CLOUDFLARE_BLOCKED"
  | "BROWSER_CONTEXT_FAILED"
  | "SESSION_DECRYPT_FAILED"
  | "SESSION_ENCRYPT_FAILED"
  | "INVALID_PROVIDER"
  | "CONCURRENCY_LOCKED"
  | "CHAT_JOB_FAILED"
  | "UNKNOWN_SAFE_ERROR";

export type ProviderCapability =
  | "connect"
  | "validate_session"
  | "send_message"
  | "pseudo_stream"
  | "multi_provider";

export type ProviderReadiness =
  | "ready"
  | "connect_only"
  | "not_implemented"
  | "disabled";

export interface ProviderDefinition {
  id: ProviderId;
  displayName: string;
  loginUrl: string;
  capabilities: ProviderCapability[];
  readiness: ProviderReadiness;
  defaultEnabled: boolean;
  subModels?: ProviderSubModel[];
}

export type ProviderEvent =
  | {
      type: "queued";
      provider: ProviderId;
      jobId: string;
    }
  | {
      type: "started";
      provider: ProviderId;
      jobId: string;
    }
  | {
      type: "message_delta";
      provider: ProviderId;
      jobId: string;
      text: string;
    }
  | {
      type: "message_complete";
      provider: ProviderId;
      jobId: string;
      text: string;
      /** Provider-side conversation URL captured after the turn, for multi-turn continuity. */
      conversationUrl?: string;
    }
  | {
      type: "requires_login";
      provider: ProviderId;
      jobId: string;
      message: string;
    }
  | {
      type: "manual_action_required";
      provider: ProviderId;
      jobId: string;
      message: string;
    }
  | {
      type: "rate_limited";
      provider: ProviderId;
      jobId: string;
      retryAfterSeconds?: number;
      message: string;
    }
  | {
      type: "error";
      provider: ProviderId;
      jobId: string;
      errorCode: ErrorCode;
      message: string;
    }
  | {
      type: "cancelled";
      provider: ProviderId;
      jobId: string;
      message: string;
    }
  | {
      type: "retrying";
      provider: ProviderId;
      jobId: string;
      retryOfJobId: string;
    }
  | {
      type: "sub_model_selected";
      provider: ProviderId;
      jobId: string;
      subModelId: string;
      label?: string;
    }
  | {
      type: "sub_model_warning";
      provider: ProviderId;
      jobId: string;
      message: string;
    }
  | {
      type: "timeout";
      provider: ProviderId;
      jobId: string;
      errorCode: "PROVIDER_TIMEOUT" | "JOB_TIMEOUT";
      message: string;
    }
  | {
      type: "done";
      provider: ProviderId;
      jobId: string;
    };

export interface PromptInput {
  userId: string;
  jobId: string;
  threadId?: string;
  prompt: string;
  saveHistory: boolean;
  /** When set, the adapter continues this provider-side conversation instead of starting a new chat. */
  conversationUrl?: string;
}

export interface ProviderSubModel {
  id: string;
  label: string;
  description?: string;
  available?: boolean | "detect";
}

export interface LiveDetectedSubModel {
  id: string;
  label: string;
  provider: ProviderId;
  source: "live";
  confidence: number;
  availability: "visible" | "disabled" | "locked" | "unknown";
  detectedAt: string;
  hints?: {
    role?: string | null;
    ariaLabel?: string | null;
    dataTestId?: string | null;
  };
}

export interface LiveSubModelDetectionResult {
  provider: ProviderId;
  status:
    | "ok"
    | "requires_login"
    | "manual_action_required"
    | "ui_changed"
    | "error";
  detectedAt: string;
  subModels: LiveDetectedSubModel[];
  warnings: string[];
  errorCode?: string;
}

export interface SelectSubModelResult {
  selected: boolean;
  subModelId: string;
  label?: string;
  warning?: string;
}

export interface SelectorCandidate {
  kind: "composer" | "send_button" | "stop_button" | "response_container" | "model_picker" | "unknown";
  selector: string;
  confidence: number; // 0-1
  reason: string;
  tagName?: string;
  role?: string | null;
  dataTestId?: string | null;
  ariaLabel?: string | null;
  placeholder?: string | null;
  textPreview?: string | null;
  visible: boolean;
  enabled?: boolean;
}

export interface ProviderUiDiagnosis {
  provider: ProviderId;
  url?: string;
  status: "ok" | "requires_login" | "manual_action_required" | "ui_changed" | "error";
  checkedAt: string;
  candidates: SelectorCandidate[];
  missingKinds: string[];
  warnings: string[];
}

export interface ChatJobPayload {
  jobId: string;
  userId: string;
  provider: ProviderId;
  threadId: string | null;
  prompt: string;
  saveHistory: boolean;
  persistUserMessage: boolean;
  selectedSubModelId?: string;
  selectedSubModelLabel?: string;
  /** Provider-side conversation URL to continue, looked up from the thread. */
  conversationUrl?: string;
}

export interface ProviderConnectionSummary {
  provider: ProviderId;
  displayName: string;
  status: ProviderStatus;
  readiness: ProviderReadiness;
  capabilities: ProviderCapability[];
  defaultEnabled: boolean;
  loginUrl: string;
  lastConnectedAt?: string | null;
  lastUsedAt?: string | null;
  lastValidatedAt?: string | null;
  errorCode?: string | null;
  errorMessageSafe?: string | null;
}

export interface WorkspaceNotification {
  id: string;
  severity: "info" | "warning" | "critical";
  kind:
    | "provider_requires_login"
    | "provider_expired"
    | "provider_manual_action"
    | "provider_ui_changed"
    | "provider_unusable"
    | "no_usable_models"
    | "provider_limit_spike"
    | "test_webhook";
  title: string;
  message: string;
  provider?: ProviderId;
  modelId?: string;
  action?: {
    label: string;
    href: string;
  };
  dismissible: boolean;
  fingerprint: string;
  createdFromStatusAt?: string | null;
}

export interface NotificationEventView {
  id: string;
  kind: WorkspaceNotification["kind"];
  severity: WorkspaceNotification["severity"];
  title: string;
  message: string;
  provider?: ProviderId;
  modelId?: string | null;
  action?: {
    label: string;
    href: string;
  };
  readAt?: string | null;
  createdAt: string;
  fingerprint: string;
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDERS as readonly string[]).includes(value);
}
