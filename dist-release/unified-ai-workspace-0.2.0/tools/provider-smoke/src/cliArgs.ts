import { isProviderId, type ProviderId } from "@uaiw/shared/types/provider.js";

export type SmokeMode =
  | "validate-session"
  | "detect-ui"
  | "diagnose-ui"
  | "send-message"
  | "stop-generation"
  | "full";

export interface SmokeCliArgs {
  provider: ProviderId;
  mode: SmokeMode;
  prompt: string;
  userId?: string;
  headless: boolean;
  showResponse: boolean;
  timeoutMs: number;
  json: boolean;
  includeStop: boolean;
  reportFile?: string;
  failOnWarn: boolean;
  noSend: boolean;
  yes: boolean;
}

const MODES: SmokeMode[] = ["validate-session", "detect-ui", "diagnose-ui", "send-message", "stop-generation", "full"];
const DEFAULT_SHORT_PROMPT = "Say hello in one short sentence.";

export function parseCliArgs(argv: string[]): SmokeCliArgs {
  const values = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, true);
    } else {
      values.set(key, next);
      index += 1;
    }
  }

  const providerValue = String(values.get("provider") ?? "gemini");
  if (!isProviderId(providerValue)) {
    throw new Error("UNKNOWN_PROVIDER");
  }

  const mode = String(values.get("mode") ?? "validate-session") as SmokeMode;
  if (!MODES.includes(mode)) {
    throw new Error("INVALID_SMOKE_MODE");
  }

  const prompt = String(
    values.get("prompt") ??
      (mode === "stop-generation"
        ? "Write a long numbered list from 1 to 100 with one short sentence per item."
        : DEFAULT_SHORT_PROMPT)
  );

  const timeoutMs = Number(values.get("timeout-ms") ?? 120_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("INVALID_TIMEOUT_MS");
  }

  const noSend = parseBoolean(values.get("no-send"), false);
  const yes = parseBoolean(values.get("yes"), false);
  if (noSend && mode !== "full") {
    throw new Error("NO_SEND_ONLY_FULL");
  }

  if (mode === "send-message" && !yes) {
    throw new Error("SEND_MESSAGE_REQUIRES_YES");
  }

  if (mode === "stop-generation" && !yes) {
    throw new Error("STOP_GENERATION_REQUIRES_YES");
  }

  if (mode === "full" && !noSend && !yes) {
    throw new Error("FULL_REQUIRES_YES_OR_NO_SEND");
  }

  return {
    provider: providerValue,
    mode,
    prompt,
    userId: typeof values.get("user-id") === "string" ? String(values.get("user-id")) : undefined,
    headless: parseBoolean(values.get("headless"), process.env.BROWSER_HEADLESS === "true"),
    showResponse: parseBoolean(values.get("show-response"), false),
    timeoutMs,
    json: parseBoolean(values.get("json"), false),
    includeStop: parseBoolean(values.get("include-stop"), false),
    reportFile: typeof values.get("report-file") === "string" ? String(values.get("report-file")) : undefined,
    failOnWarn: parseBoolean(values.get("fail-on-warn"), false),
    noSend,
    yes
  };
}

function parseBoolean(value: string | boolean | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value == null) return fallback;
  return value === "true";
}
