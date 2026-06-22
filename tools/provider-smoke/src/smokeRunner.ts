import { chromium, type Browser, type BrowserContext } from "playwright";
import { providerRegistry } from "@uaiw/provider-adapters/ProviderRegistry.js";
import type { ProviderId } from "@uaiw/shared/types/provider.js";
import { detectUiMode, sendMessageMode, stopGenerationMode, validateSessionMode, diagnoseUiMode } from "./modes.js";
import type { SmokeCliArgs } from "./cliArgs.js";
import { aggregateStatus, responsePreview, type SmokeCheck, type SmokeReport } from "./report.js";
import { loadConnection } from "./loadConnection.js";

export async function runSmoke(args: SmokeCliArgs): Promise<SmokeReport> {
  const startedAt = new Date();
  const started = Date.now();
  const checks: SmokeCheck[] = [];
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let responseText = "";

  try {
    const registered = providerRegistry.get(args.provider);
    checks.push({ name: "provider_registered", status: "pass" });

    const needsSendCapability =
      args.mode === "send-message" ||
      args.mode === "stop-generation" ||
      (args.mode === "full" && !args.noSend);
    if (needsSendCapability && !registered.definition.capabilities.includes("send_message")) {
      throw new Error("PROVIDER_NOT_READY");
    }

    const loaded = await loadConnection({ provider: args.provider, userId: args.userId });
    checks.push({ name: "connection_exists", status: "pass" });
    checks.push({ name: "encrypted_session_exists", status: "pass" });
    checks.push({ name: "session_decrypt_ok", status: "pass" });

    browser = await chromium.launch({
      headless: args.headless,
      channel: process.env.BROWSER_CHANNEL === "chromium" ? undefined : process.env.BROWSER_CHANNEL,
      args: ["--disable-dev-shm-usage"]
    });
    context = await browser.newContext({
      storageState: loaded.sessionState as never,
      viewport: { width: 1365, height: 900 },
      recordVideo: undefined
    });
    checks.push({ name: "browser_context_created", status: "pass" });

    const modeChecks = await runSelectedMode(args, context, registered.adapter, args.provider);
    checks.push(...modeChecks.checks);
    responseText = modeChecks.responseText ?? "";

    return buildReport(args, startedAt, started, checks, responseText);
  } catch (error) {
    const safe = toSafeSmokeError(error);
    checks.push({ name: "smoke_error", status: "fail", message: safe.message });
    return {
      ...buildReport(args, startedAt, started, checks, responseText),
      status: "fail",
      errorCode: safe.errorCode,
      errorMessage: safe.message,
      hint: safe.hint
    };
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

async function runSelectedMode(
  args: SmokeCliArgs,
  context: BrowserContext,
  adapter: ReturnType<typeof providerRegistry.get>["adapter"],
  provider: ProviderId
) {
  if (args.mode === "validate-session") return validateSessionMode(adapter, context);
  if (args.mode === "detect-ui") return detectUiMode({ provider, adapter, context });
  if (args.mode === "diagnose-ui") return diagnoseUiMode({ provider, adapter, context });
  if (args.mode === "send-message") {
    return sendMessageMode({ adapter, context, provider, prompt: args.prompt, timeoutMs: args.timeoutMs });
  }
  if (args.mode === "stop-generation") return stopGenerationMode({ adapter, context });

  const validate = await validateSessionMode(adapter, context);
  const detect = await detectUiMode({ provider, adapter, context });
  if (args.noSend) {
    return {
      checks: [
        ...validate.checks,
        ...detect.checks,
        { name: "send_message_skipped", status: "pass" as const, message: "--no-send enabled" }
      ],
      responseText: ""
    };
  }

  const send = await sendMessageMode({ adapter, context, provider, prompt: args.prompt, timeoutMs: args.timeoutMs });
  const stop = args.includeStop ? await stopGenerationMode({ adapter, context }) : { checks: [] };

  return {
    checks: [
      ...validate.checks,
      ...detect.checks,
      ...send.checks,
      ...stop.checks
    ],
    responseText: send.responseText
  };
}

function buildReport(
  args: SmokeCliArgs,
  startedAt: Date,
  started: number,
  checks: SmokeCheck[],
  responseText: string
): SmokeReport {
  return {
    provider: args.provider,
    mode: args.mode,
    status: aggregateStatus(checks),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - started,
    checks,
    responseLength: responseText ? responseText.length : undefined,
    responsePreview: responsePreview(responseText, args.showResponse),
    reportVersion: 1,
    safe: true
  };
}

function toSafeSmokeError(error: unknown): { errorCode: string; message: string; hint?: string } {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("UNKNOWN_PROVIDER")) return { errorCode: "UNKNOWN_PROVIDER", message: "Unknown provider." };
  if (message.includes("PROVIDER_NOT_READY")) return { errorCode: "PROVIDER_NOT_READY", message: "This provider is not chat-ready yet." };
  if (message.includes("REQUIRES_LOGIN")) {
    return {
      errorCode: "REQUIRES_LOGIN",
      message: "Provider session is missing or expired.",
      hint: "Open /connections and reconnect the provider."
    };
  }
  if (message.includes("SESSION_DECRYPT_FAILED") || message.includes("SESSION_MASTER_KEY")) {
    return {
      errorCode: "SESSION_DECRYPT_FAILED",
      message: "Stored session could not be decrypted.",
      hint: "Check SESSION_MASTER_KEY matches the key used when connecting the provider."
    };
  }
  if (message.includes("MANUAL_ACTION_REQUIRED")) return { errorCode: "MANUAL_ACTION_REQUIRED", message: "Manual provider verification is required." };
  if (message.includes("PROVIDER_UI_CHANGED")) {
    return {
      errorCode: "PROVIDER_UI_CHANGED",
      message: "Provider UI selectors may have changed.",
      hint: "Run detect-ui and update provider selectors."
    };
  }
  if (message.includes("PROVIDER_TIMEOUT") || message.includes("Timeout")) {
    return {
      errorCode: "PROVIDER_TIMEOUT",
      message: "Provider did not respond before timeout.",
      hint: "Try again or increase timeout-ms."
    };
  }
  if (message.includes("USER_NOT_FOUND")) {
    return {
      errorCode: "USER_NOT_FOUND",
      message: "No local user found.",
      hint: "Start the app and create/login local user first."
    };
  }
  return { errorCode: "SMOKE_FAILED", message: "Provider smoke test failed." };
}
