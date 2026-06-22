export function mapInternalErrorToOpenAI(errorCode: string, errorMessage: string) {
  let type = "internal_error";
  let code = "internal_error";

  if (errorCode === "REQUIRES_LOGIN" || errorCode === "PROVIDER_NOT_READY") {
    type = "provider_error";
    code = errorCode.toLowerCase();
  } else if (errorCode === "UNKNOWN_PROVIDER") {
    type = "invalid_request_error";
    code = "model_not_found";
  } else if (errorCode === "CHAT_JOB_FAILED") {
    type = "server_error";
    code = "internal_error";
  } else if (errorCode === "TIMEOUT") {
    type = "provider_error";
    code = "provider_timeout";
  } else if (errorCode === "RATE_LIMITED") {
    type = "rate_limit_error";
    code = "provider_rate_limited";
  } else if (errorCode === "PROVIDER_RATE_LIMIT_EXCEEDED") {
    type = "rate_limit_error";
    code = "provider_rate_limit_exceeded";
  }

  return {
    error: {
      message: errorMessage,
      type,
      code
    }
  };
}
