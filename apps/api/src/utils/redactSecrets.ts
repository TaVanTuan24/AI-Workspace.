import type { ApiEnv } from "../config/env.js";

const CREDENTIALS_URL_REGEX = /(https?:\/\/)([^:@\s]+):([^@\s]+)@/g;
const BEARER_TOKEN_REGEX = /(bearer\s+)([a-zA-Z0-9\-_.]+)/gi;
const INVITE_TOKEN_REGEX = /(inv_[a-zA-Z0-9]{32,})/g;
const GENERIC_API_KEY_REGEX = /(api[_-]?key\s*[:=]\s*)(["']?)([a-zA-Z0-9\-_]{20,})\2/gi;

export function redactSecrets(input: string, env?: ApiEnv): string {
  if (!input) return input;

  let redacted = input;

  // Redact URLs with basic auth
  redacted = redacted.replace(CREDENTIALS_URL_REGEX, "$1$2:***@");

  // Redact Bearer tokens
  redacted = redacted.replace(BEARER_TOKEN_REGEX, (match, prefix, token) => {
    return `${prefix}***`;
  });

  // Redact invite tokens
  redacted = redacted.replace(INVITE_TOKEN_REGEX, "inv_***");

  // Redact generic API keys
  redacted = redacted.replace(GENERIC_API_KEY_REGEX, (match, prefix, quote, key) => {
    return `${prefix}${quote}***${quote}`;
  });

  // Redact known environment secrets if env is provided
  if (env) {
    const secretsToRedact = [
      env.INTERNAL_API_KEY,
      env.API_KEY_HASH_SECRET
    ].filter((s): s is string => typeof s === "string" && s.length > 0);

    for (const secret of secretsToRedact) {
      // Escape secret for regex
      const escapedSecret = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedSecret, 'g');
      redacted = redacted.replace(regex, "***");
    }
  }

  return redacted;
}
