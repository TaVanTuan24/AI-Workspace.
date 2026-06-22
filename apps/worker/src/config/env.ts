import { parseMasterKey } from "@uaiw/session-vault/index.js";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("file:./dev.db"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  BROWSER_HEADLESS: z.coerce.boolean().default(false),
  BROWSER_PROFILE_ROOT: z.string().default(".data/browser-profiles"),
  CHAT_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  CHAT_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  NOTIFICATION_WEBHOOK_RETRY_ENABLED: z.coerce.boolean().default(true),
  NOTIFICATION_WEBHOOK_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  NOTIFICATION_WEBHOOK_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(30000),
  NOTIFICATION_WEBHOOK_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(900000)
});

export type WorkerEnv = z.infer<typeof envSchema>;

type ParseOptions = {
  warn?: (message: string) => void;
};

export function parseEnv(raw: NodeJS.ProcessEnv, options: ParseOptions = {}): WorkerEnv {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const parsed = envSchema.parse({
    ...raw,
    NODE_ENV: raw.NODE_ENV ?? (raw.VITEST ? "test" : undefined)
  });
  const errors: string[] = [];
  const isProduction = parsed.NODE_ENV === "production";
  const shouldWarn = parsed.NODE_ENV !== "test";

  if (!isRedisUrl(parsed.REDIS_URL)) {
    errors.push("REDIS_URL must be a valid redis:// or rediss:// URL.");
  }

  if (!raw.SESSION_MASTER_KEY) {
    if (isProduction) {
      errors.push("SESSION_MASTER_KEY is required in production.");
    } else if (shouldWarn) {
      warn("SESSION_MASTER_KEY is not set; provider session decryption will fail until it is configured.");
    }
  } else {
    try {
      parseMasterKey(raw.SESSION_MASTER_KEY);
    } catch {
      errors.push("SESSION_MASTER_KEY must be base64 or 64-character hex and decode to exactly 32 bytes.");
    }
  }

  if (isProduction && !raw.DATABASE_URL) {
    errors.push("DATABASE_URL is required in production.");
  }

  if (parsed.NOTIFICATION_WEBHOOK_RETRY_MAX_DELAY_MS < parsed.NOTIFICATION_WEBHOOK_RETRY_BASE_DELAY_MS) {
    errors.push("NOTIFICATION_WEBHOOK_RETRY_MAX_DELAY_MS must be greater than or equal to NOTIFICATION_WEBHOOK_RETRY_BASE_DELAY_MS.");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid worker environment:\n- ${errors.join("\n- ")}`);
  }

  return parsed;
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
