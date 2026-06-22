import { isProviderId } from "@uaiw/shared/types/provider.js";
import { parseCliArgs, type SmokeCliArgs } from "./cliArgs.js";
import type { SmokeMode } from "./cliArgs.js";
import {
  exitCodeForReport,
  formatTextReport,
  safeJsonReport,
  type SmokeReport,
  writeReportFile
} from "./report.js";
import { disconnectPrisma } from "./loadConnection.js";
import { runSmoke } from "./smokeRunner.js";

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  let args: SmokeCliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    const report = buildCliErrorReport(error, argv);
    const reportFile = rawFlagValue(argv, "report-file");
    if (reportFile) await writeReportFile(report, reportFile).catch(() => {});
    process.stdout.write(json ? `${safeJsonReport(report)}\n` : `${formatTextReport(report)}\n`);
    process.exitCode = 2;
    return;
  }

  const report = await runSmoke(args);
  if (args.reportFile) await writeReportFile(report, args.reportFile);
  process.stdout.write(args.json ? `${safeJsonReport(report)}\n` : `${formatTextReport(report)}\n`);
  process.exitCode = exitCodeForReport(report, args.failOnWarn);
}

function buildCliErrorReport(error: unknown, argv: string[]): SmokeReport {
  const message = error instanceof Error ? error.message : "";
  const errorCode = message.includes("UNKNOWN_PROVIDER")
    ? "UNKNOWN_PROVIDER"
    : message.includes("INVALID_SMOKE_MODE")
      ? "INVALID_SMOKE_MODE"
      : message.includes("INVALID_TIMEOUT_MS")
        ? "INVALID_TIMEOUT_MS"
        : message.includes("NO_SEND_ONLY_FULL")
          ? "NO_SEND_ONLY_FULL"
          : message.includes("SEND_MESSAGE_REQUIRES_YES")
            ? "SEND_MESSAGE_REQUIRES_YES"
            : message.includes("STOP_GENERATION_REQUIRES_YES")
              ? "STOP_GENERATION_REQUIRES_YES"
              : message.includes("FULL_REQUIRES_YES_OR_NO_SEND")
                ? "FULL_REQUIRES_YES_OR_NO_SEND"
                : "INVALID_ARGUMENTS";

  return {
    provider: safeProviderFromArgv(argv),
    mode: safeModeFromArgv(argv),
    status: "fail",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    checks: [{ name: "parse_cli_args", status: "fail", message: errorCode }],
    errorCode,
    errorMessage: cliErrorMessage(errorCode),
    hint: cliErrorHint(errorCode),
    reportVersion: 1,
    safe: true
  };
}

function safeProviderFromArgv(argv: string[]) {
  const provider = rawFlagValue(argv, "provider");
  return provider && isProviderId(provider) ? provider : "gemini";
}

function safeModeFromArgv(argv: string[]): SmokeMode {
  const mode = rawFlagValue(argv, "mode");
  return isSmokeMode(mode) ? mode : "validate-session";
}

function isSmokeMode(value: string | undefined): value is SmokeMode {
  return value === "validate-session" ||
    value === "detect-ui" ||
    value === "send-message" ||
    value === "stop-generation" ||
    value === "full";
}

function rawFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(`--${flag}`);
  const next = index >= 0 ? argv[index + 1] : undefined;
  return next && !next.startsWith("--") ? next : undefined;
}

function cliErrorMessage(errorCode: string): string {
  if (errorCode === "SEND_MESSAGE_REQUIRES_YES") return "Mode send-message sends a real prompt.";
  if (errorCode === "STOP_GENERATION_REQUIRES_YES") return "Mode stop-generation can interact with a live provider page.";
  if (errorCode === "FULL_REQUIRES_YES_OR_NO_SEND") return "Mode full sends a real prompt unless --no-send is used.";
  if (errorCode === "NO_SEND_ONLY_FULL") return "--no-send is only valid with mode full.";
  return "Invalid provider smoke test arguments.";
}

function cliErrorHint(errorCode: string): string | undefined {
  if (errorCode === "SEND_MESSAGE_REQUIRES_YES") return "Re-run with --yes after confirming real provider usage.";
  if (errorCode === "STOP_GENERATION_REQUIRES_YES") return "Re-run with --yes after confirming live provider interaction.";
  if (errorCode === "FULL_REQUIRES_YES_OR_NO_SEND") return "Re-run with --yes or use --no-send.";
  return undefined;
}

main()
  .catch(() => {
    const report: SmokeReport = {
      provider: "gemini",
      mode: "validate-session",
      status: "fail",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      checks: [{ name: "internal_error", status: "fail", message: "SMOKE_INTERNAL_ERROR" }],
      errorCode: "SMOKE_INTERNAL_ERROR",
      errorMessage: "Provider smoke test failed unexpectedly.",
      reportVersion: 1,
      safe: true
    };
    const argv = process.argv.slice(2);
    process.stdout.write(argv.includes("--json") ? `${safeJsonReport(report)}\n` : `${formatTextReport(report)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma().catch(() => {});
  });
