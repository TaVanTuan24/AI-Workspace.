import { parseMasterKey } from "@uaiw/session-vault/index.js";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default("file:./dev.db"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  LOCAL_SINGLE_USER_MODE: z.coerce.boolean().default(true),
  BROWSER_HEADLESS: z.coerce.boolean().default(false),
  BROWSER_CHANNEL: z.string().default("chromium"),
  LOCAL_BROWSER_MODE: z.coerce.boolean().default(true),
  BROWSER_PROFILE_ROOT: z.string().default(".data/browser-profiles"),
  CHAT_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  INTERNAL_API_KEY: z.string().optional(),
  INTERNAL_API_SAVE_HISTORY: z.coerce.boolean().default(true),
  OPENAI_COMPAT_NONSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(240_000),
  INTERNAL_API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  INTERNAL_API_RATE_LIMIT_MAX_PER_MINUTE: z.coerce.number().int().positive().default(300),
  PROVIDER_RATE_LIMIT_DEFAULT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  PROVIDER_RATE_LIMIT_MAX_PER_MINUTE: z.coerce.number().int().positive().default(300),
  PROVIDER_RATE_LIMIT_CHATGPT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  PROVIDER_RATE_LIMIT_GEMINI_PER_MINUTE: z.coerce.number().int().positive().default(30),
  PROVIDER_RATE_LIMIT_GROK_PER_MINUTE: z.coerce.number().int().positive().default(10),
  API_KEY_HASH_SECRET: z.string().optional(),
  ENABLE_DB_API_KEYS: z.coerce.boolean().default(false),
  API_USAGE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  NOTIFICATION_EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  PROVIDER_HEALTH_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  PROVIDER_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  PROVIDER_HEALTH_SCHEDULER_ENABLED: z.coerce.boolean().default(false),
  PROVIDER_HEALTH_SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(900),
  PROVIDER_HEALTH_SCHEDULER_JITTER_SECONDS: z.coerce.number().int().min(0).default(60),
  PROVIDER_HEALTH_SCHEDULER_LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(840),
  PROVIDER_HEALTH_SCHEDULER_MAX_USERS_PER_RUN: z.coerce.number().int().positive().default(50),
  PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED: z.coerce.boolean().default(false),
  WORKSPACE_INVITE_EXPIRY_SCHEDULER_ENABLED: z.coerce.boolean().default(false),
  WORKSPACE_INVITE_EXPIRY_INTERVAL_SECONDS: z.coerce.number().default(3600),
  WORKSPACE_INVITE_EXPIRY_LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  WORKSPACE_INVITE_EXPIRY_MAX_PER_RUN: z.coerce.number().int().min(1).default(100),
  WORKSPACE_INVITE_EMAIL_DELIVERY_ENABLED: z.coerce.boolean().default(false),
  WORKSPACE_INVITE_EMAIL_CHANNEL: z.string().default("email_noop"),
  WORKSPACE_INVITE_BASE_URL: z.string().optional(),
  PROVIDER_RECOVERY_OVERRIDE_EXPIRY_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(300),
  PROVIDER_RECOVERY_OVERRIDE_EXPIRY_LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  PROVIDER_RECOVERY_OVERRIDE_EXPIRY_MAX_PER_RUN: z.coerce.number().int().min(1).max(5000).default(500),
  NOTIFICATION_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  NOTIFICATION_WEBHOOK_ALLOW_LOCALHOST: z.coerce.boolean().default(false),
  NOTIFICATION_SECRET_ENCRYPTION_KEY: z.string().optional(),
  NOTIFICATION_WEBHOOK_RETRY_ENABLED: z.coerce.boolean().default(true),
  NOTIFICATION_WEBHOOK_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  NOTIFICATION_WEBHOOK_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(30000),
  NOTIFICATION_WEBHOOK_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(900000)
});

export type ApiEnv = z.infer<typeof envSchema>;

type ParseOptions = {
  warn?: (message: string) => void;
};

const WEAK_SECRET_MARKERS = [
  "changeme",
  "change-me",
  "replace",
  "example",
  "local-random-secret",
  "dev-secret",
  "password",
  "secret"
];

export function parseEnv(raw: NodeJS.ProcessEnv, options: ParseOptions = {}): ApiEnv {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const parsed = envSchema.parse({
    ...raw,
    NODE_ENV: raw.NODE_ENV ?? (raw.VITEST ? "test" : undefined),
    PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED:
      raw.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_SCHEDULER_ENABLED ??
      (raw.NODE_ENV === "production" ? "true" : undefined),
    WORKSPACE_INVITE_EXPIRY_SCHEDULER_ENABLED:
      raw.WORKSPACE_INVITE_EXPIRY_SCHEDULER_ENABLED ??
      (raw.NODE_ENV === "test" ? "false" : "true")
  });
  const errors: string[] = [];
  const isProduction = parsed.NODE_ENV === "production";
  const shouldWarn = parsed.NODE_ENV !== "test";

  if (!isRedisUrl(parsed.REDIS_URL)) {
    errors.push("REDIS_URL must be a valid redis:// or rediss:// URL.");
  }

  if (parsed.INTERNAL_API_RATE_LIMIT_PER_MINUTE > parsed.INTERNAL_API_RATE_LIMIT_MAX_PER_MINUTE) {
    errors.push("INTERNAL_API_RATE_LIMIT_PER_MINUTE must be less than or equal to INTERNAL_API_RATE_LIMIT_MAX_PER_MINUTE.");
  }

  if (parsed.PROVIDER_RATE_LIMIT_DEFAULT_PER_MINUTE > parsed.PROVIDER_RATE_LIMIT_MAX_PER_MINUTE) {
    errors.push("PROVIDER_RATE_LIMIT_DEFAULT_PER_MINUTE must be less than or equal to PROVIDER_RATE_LIMIT_MAX_PER_MINUTE.");
  }

  const providerLimits = [
    ["PROVIDER_RATE_LIMIT_CHATGPT_PER_MINUTE", parsed.PROVIDER_RATE_LIMIT_CHATGPT_PER_MINUTE],
    ["PROVIDER_RATE_LIMIT_GEMINI_PER_MINUTE", parsed.PROVIDER_RATE_LIMIT_GEMINI_PER_MINUTE],
    ["PROVIDER_RATE_LIMIT_GROK_PER_MINUTE", parsed.PROVIDER_RATE_LIMIT_GROK_PER_MINUTE]
  ] as const;
  for (const [name, value] of providerLimits) {
    if (value > parsed.PROVIDER_RATE_LIMIT_MAX_PER_MINUTE) {
      errors.push(`${name} must be less than or equal to PROVIDER_RATE_LIMIT_MAX_PER_MINUTE.`);
    }
  }

  if (parsed.PROVIDER_HEALTH_SCHEDULER_LOCK_TTL_SECONDS > parsed.PROVIDER_HEALTH_SCHEDULER_INTERVAL_SECONDS) {
    warn("PROVIDER_HEALTH_SCHEDULER_LOCK_TTL_SECONDS is greater than the scheduler interval; clamping lock TTL to the interval.");
    parsed.PROVIDER_HEALTH_SCHEDULER_LOCK_TTL_SECONDS = parsed.PROVIDER_HEALTH_SCHEDULER_INTERVAL_SECONDS;
  }

  if (parsed.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_LOCK_TTL_SECONDS > parsed.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_INTERVAL_SECONDS) {
    warn("PROVIDER_RECOVERY_OVERRIDE_EXPIRY_LOCK_TTL_SECONDS is greater than the scheduler interval; clamping lock TTL to the interval.");
    parsed.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_LOCK_TTL_SECONDS = parsed.PROVIDER_RECOVERY_OVERRIDE_EXPIRY_INTERVAL_SECONDS;
  }

  if (parsed.WORKSPACE_INVITE_EXPIRY_LOCK_TTL_SECONDS > parsed.WORKSPACE_INVITE_EXPIRY_INTERVAL_SECONDS) {
    warn("WORKSPACE_INVITE_EXPIRY_LOCK_TTL_SECONDS is greater than the scheduler interval; clamping lock TTL to the interval.");
    parsed.WORKSPACE_INVITE_EXPIRY_LOCK_TTL_SECONDS = parsed.WORKSPACE_INVITE_EXPIRY_INTERVAL_SECONDS;
  }

  validateSessionMasterKey(raw.SESSION_MASTER_KEY, isProduction, shouldWarn, errors, warn);

  if (parsed.NOTIFICATION_SECRET_ENCRYPTION_KEY) {
    validateSecret("NOTIFICATION_SECRET_ENCRYPTION_KEY", parsed.NOTIFICATION_SECRET_ENCRYPTION_KEY, isProduction, shouldWarn, errors, warn, 32);
  }

  if (parsed.NOTIFICATION_WEBHOOK_RETRY_MAX_DELAY_MS < parsed.NOTIFICATION_WEBHOOK_RETRY_BASE_DELAY_MS) {
    errors.push("NOTIFICATION_WEBHOOK_RETRY_MAX_DELAY_MS must be greater than or equal to NOTIFICATION_WEBHOOK_RETRY_BASE_DELAY_MS.");
  }

  if (parsed.ENABLE_DB_API_KEYS) {
    validateSecret("API_KEY_HASH_SECRET", parsed.API_KEY_HASH_SECRET, isProduction, shouldWarn, errors, warn, 32);
  } else {
    validateSecret("INTERNAL_API_KEY", parsed.INTERNAL_API_KEY, isProduction, shouldWarn, errors, warn, 24);
  }

  if (isProduction && !raw.DATABASE_URL) {
    errors.push("DATABASE_URL is required in production.");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid API environment:\n- ${errors.join("\n- ")}`);
  }

  return parsed;
}

function validateSessionMasterKey(
  value: string | undefined,
  isProduction: boolean,
  shouldWarn: boolean,
  errors: string[],
  warn: (message: string) => void
): void {
  if (!value) {
    if (isProduction) {
      errors.push("SESSION_MASTER_KEY is required in production.");
    } else if (shouldWarn) {
      warn("SESSION_MASTER_KEY is not set; provider session encryption will fail until it is configured.");
    }
    return;
  }

  try {
    parseMasterKey(value);
  } catch {
    errors.push("SESSION_MASTER_KEY must be base64 or 64-character hex and decode to exactly 32 bytes.");
  }
}

function validateSecret(
  name: string,
  value: string | undefined,
  isProduction: boolean,
  shouldWarn: boolean,
  errors: string[],
  warn: (message: string) => void,
  minLength: number
): void {
  if (!value) {
    if (isProduction) {
      errors.push(`${name} is required in production.`);
    } else if (shouldWarn) {
      warn(`${name} is not set; related functionality will be unavailable until configured.`);
    }
    return;
  }

  if (isProduction && value.length < minLength) {
    errors.push(`${name} must be at least ${minLength} characters in production.`);
  }

  const normalized = value.toLowerCase();
  if (isProduction && WEAK_SECRET_MARKERS.some((marker) => normalized.includes(marker))) {
    errors.push(`${name} appears to be a placeholder or weak secret.`);
  }
}

function isRedisUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "redis:" || url.protocol === "rediss:";
  } catch {
    return false;
  }
}

export const env = parseEnv(process.env);
