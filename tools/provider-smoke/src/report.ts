import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProviderId } from "@uaiw/shared/types/provider.js";
import type { SmokeMode } from "./cliArgs.js";

export interface SmokeCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message?: string;
  hint?: string;
  durationMs?: number;
}

export interface SmokeReport {
  provider: ProviderId;
  mode: SmokeMode;
  status: "pass" | "warn" | "fail";
  startedAt: string;
  durationMs: number;
  checks: SmokeCheck[];
  errorCode?: string;
  errorMessage?: string;
  hint?: string;
  responsePreview?: string;
  responseLength?: number;
  reportVersion: 1;
  safe: true;
}

export function aggregateStatus(checks: SmokeCheck[]): SmokeReport["status"] {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

export function responsePreview(text: string, showResponse: boolean): string | undefined {
  if (!showResponse) return undefined;
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

export function formatTextReport(report: SmokeReport): string {
  const lines = [`Provider smoke test: ${report.provider} / ${report.mode}`, ""];
  for (const check of report.checks) {
    lines.push(`${check.status.toUpperCase()} ${check.name}${check.message ? ` - ${check.message}` : ""}`);
  }
  lines.push("");
  lines.push(`Status: ${report.status.toUpperCase()}`);
  lines.push(`Duration: ${report.durationMs}ms`);
  if (report.responseLength != null) lines.push(`Response length: ${report.responseLength}`);
  if (report.responsePreview) lines.push(`Response preview: ${report.responsePreview}`);
  if (report.errorCode) lines.push(`Error: ${report.errorCode} ${report.errorMessage ?? ""}`.trim());
  if (report.hint) lines.push(`Hint: ${report.hint}`);
  return lines.join("\n");
}

export function safeJsonReport(report: SmokeReport): string {
  return JSON.stringify(report, null, 2);
}

export async function writeReportFile(report: SmokeReport, reportFile: string): Promise<void> {
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(reportFile, `${safeJsonReport(report)}\n`, "utf8");
}

export function exitCodeForReport(report: SmokeReport, failOnWarn: boolean): number {
  if (report.status === "fail") return 1;
  if (report.status === "warn" && failOnWarn) return 1;
  return 0;
}
