import type { ErrorCode, ProviderId } from "@uaiw/shared/types/provider.js";

export interface SafeProviderError {
  errorCode: ErrorCode;
  message: string;
}

export class SafeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = 'SafeError';
  }
}

export function toSafeProviderError(error: unknown, provider: ProviderId = "gemini"): SafeProviderError {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const displayName = provider === "chatgpt" ? "ChatGPT" : provider === "grok" ? "Grok" : "Gemini";

  if (message.includes("UNKNOWN_PROVIDER")) {
    return { errorCode: "UNKNOWN_PROVIDER", message: "Unknown provider." };
  }
  if (message.includes("PROVIDER_NOT_READY")) {
    return { errorCode: "PROVIDER_NOT_READY", message: "This provider is not chat-ready yet." };
  }
  if (message.includes("PROVIDER_NOT_CONNECTED")) {
    return { errorCode: "PROVIDER_NOT_CONNECTED", message: `Please reconnect ${displayName}.` };
  }
  if (message.includes("JOB_CANCELLED")) {
    return { errorCode: "JOB_CANCELLED", message: "Job was cancelled." };
  }
  if (message.includes("JOB_TIMEOUT")) {
    return { errorCode: "JOB_TIMEOUT", message: `${displayName} job timed out.` };
  }
  if (message.includes("WORKER_UNAVAILABLE")) {
    return { errorCode: "WORKER_UNAVAILABLE", message: "Worker is unavailable." };
  }
  if (message.includes("SESSION_DECRYPT_FAILED")) {
    return { errorCode: "SESSION_DECRYPT_FAILED", message: `Please reconnect ${displayName}.` };
  }
  if (message.includes("REQUIRES_LOGIN") || message.includes("SESSION_EXPIRED")) {
    return { errorCode: "REQUIRES_LOGIN", message: `Please reconnect ${displayName}.` };
  }
  if (message.includes("MANUAL_ACTION_REQUIRED")) {
    return {
      errorCode: "MANUAL_ACTION_REQUIRED",
      message: "Manual verification required in provider browser."
    };
  }
  if (message.includes("PROVIDER_UI_CHANGED")) {
    return {
      errorCode: "PROVIDER_UI_CHANGED",
      message: `${displayName} UI may have changed. Please update selectors.`
    };
  }
  if (message.includes("PROVIDER_RATE_LIMITED")) {
    return {
      errorCode: "PROVIDER_RATE_LIMITED",
      message: `${displayName} reports a rate or usage limit. Please wait and retry later.`
    };
  }
  if (message.includes("PROVIDER_TIMEOUT") || message.includes("Timeout")) {
    return {
      errorCode: "PROVIDER_TIMEOUT",
      message: `${displayName} did not finish response in time.`
    };
  }
  if (message.includes("BROWSER_CONTEXT_FAILED")) {
    return {
      errorCode: "BROWSER_CONTEXT_FAILED",
      message: `Unable to open a browser context for ${displayName}.`
    };
  }

  return { errorCode: "UNKNOWN_SAFE_ERROR", message: "Unexpected provider error." };
}
