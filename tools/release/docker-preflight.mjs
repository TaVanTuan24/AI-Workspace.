#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, root } from "./lib.mjs";
import { redactSensitiveText } from "./staging-verify.mjs";

export const DEFAULT_PREFLIGHT_STATUS_PATH = path.join(root, "tmp", "release", "staging-preflight-status.json");

export const DOCKER_DAEMON_NEXT_STEPS = [
  "Start Docker Desktop.",
  "On Windows, switch Docker Desktop to Linux containers/engine.",
  "Wait until `docker info` succeeds.",
  "Rerun `corepack pnpm release:staging:local --env-file .env.staging --expected-version 0.3.0 --base-url http://localhost:4000 --down`."
];

export async function checkDockerCli(deps = {}) {
  return runCheck({
    name: "dockerCli",
    command: "docker",
    args: ["--version"],
    code: "docker_cli_missing",
    failMessage: "Docker CLI is not available. Install Docker Desktop or the Docker CLI.",
    deps
  });
}

export async function checkDockerCompose(deps = {}) {
  return runCheck({
    name: "dockerCompose",
    command: "docker",
    args: ["compose", "version"],
    code: "docker_compose_missing",
    failMessage: "Docker Compose is not available. Install Docker Desktop with Compose v2.",
    deps
  });
}

export async function checkDockerDaemon(deps = {}) {
  return runCheck({
    name: "dockerDaemon",
    command: "docker",
    args: ["version", "--format", "{{.Server.Version}}"],
    code: "docker_daemon_unavailable",
    failMessage: "Docker daemon is unavailable.",
    nextSteps: DOCKER_DAEMON_NEXT_STEPS,
    deps
  });
}

export async function runDockerPreflight(options = {}, deps = {}) {
  const requireDaemon = options.requireDaemon !== false;
  const checks = {
    dockerCli: await checkDockerCli(deps)
  };

  if (!checks.dockerCli.ok) return buildReport(checks, requireDaemon);

  checks.dockerCompose = await checkDockerCompose(deps);
  if (!checks.dockerCompose.ok) return buildReport(checks, requireDaemon);

  if (requireDaemon) {
    checks.dockerDaemon = await checkDockerDaemon(deps);
  } else {
    checks.dockerDaemon = {
      name: "dockerDaemon",
      ok: true,
      status: "skipped",
      detail: "skipped for dry-run"
    };
  }

  return buildReport(checks, requireDaemon);
}

function buildReport(checks, requireDaemon) {
  const ordered = ["dockerCli", "dockerCompose", "dockerDaemon"]
    .map((key) => checks[key])
    .filter(Boolean);
  const failed = ordered.find((item) => !item.ok);

  return {
    result: failed ? "fail" : "pass",
    requireDaemon,
    failureCode: failed?.code,
    checks,
    nextSteps: failed?.nextSteps || []
  };
}

async function runCheck({ name, command, args, code, failMessage, nextSteps = [], deps }) {
  const runCommand = deps.runCommand || runCapture;
  try {
    const output = await runCommand(command, args);
    return {
      name,
      ok: true,
      status: "ok",
      command: formatCommand(command, args),
      detail: sanitizeDockerOutput(output || "ok", 200)
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: "fail",
      code,
      command: formatCommand(command, args),
      message: failMessage,
      detail: code === "docker_daemon_unavailable"
        ? summarizeDockerDaemonError(error instanceof Error ? error.message : String(error))
        : sanitizeDockerOutput(error instanceof Error ? error.message : String(error)),
      nextSteps
    };
  }
}

export async function writeDockerPreflightStatus(report, options = {}) {
  const statusPath = options.statusPath || DEFAULT_PREFLIGHT_STATUS_PATH;
  const dockerCli = statusFor(report.checks.dockerCli);
  const dockerCompose = statusFor(report.checks.dockerCompose);
  const dockerDaemon = statusFor(report.checks.dockerDaemon);
  const content = {
    checkedAt: new Date().toISOString(),
    dockerCli,
    dockerCompose,
    dockerDaemon,
    markerGenerated: Boolean(options.markerGenerated),
    nextStep: dockerDaemon === "unavailable"
      ? "Start Docker Desktop and rerun release:staging:local"
      : "Rerun release:staging:local"
  };

  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  return { path: statusPath, content };
}

export async function readDockerPreflightStatus(options = {}) {
  const statusPath = options.statusPath || DEFAULT_PREFLIGHT_STATUS_PATH;
  try {
    return {
      ok: true,
      path: statusPath,
      content: JSON.parse(await fs.readFile(statusPath, "utf8"))
    };
  } catch {
    return { ok: false, path: statusPath };
  }
}

function statusFor(check) {
  if (!check) return "not_checked";
  if (check.status === "skipped") return "skipped";
  if (check.ok) return "ok";
  if (check.code === "docker_daemon_unavailable") return "unavailable";
  return "missing";
}

export function formatDockerPreflightSummary(report) {
  const lines = ["Docker preflight:"];
  for (const key of ["dockerCli", "dockerCompose", "dockerDaemon"]) {
    const check = report.checks[key];
    if (!check) continue;
    const label = check.ok ? (check.status === "skipped" ? "SKIP" : "PASS") : "FAIL";
    lines.push(`${label} ${key}${check.message ? ` - ${check.message}` : ""}${check.detail ? ` (${check.detail})` : ""}`);
  }
  if (report.nextSteps.length > 0) {
    lines.push("Next steps:");
    for (const step of report.nextSteps) lines.push(`- ${step}`);
  }
  lines.push(`Result: ${report.result.toUpperCase()}`);
  return lines.join("\n");
}

export function sanitizeDockerOutput(value, maxLength = 500) {
  let output = redactSensitiveText(String(value));
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) output = output.split(home).join("[home]");
  output = output.replace(/C:\\Users\\[^\\\s]+/gi, "C:\\Users\\[redacted]");
  output = output.replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]");
  output = output.replace(/\s+/g, " ").trim();
  if (output.length > maxLength) return `${output.slice(0, maxLength)}... [truncated]`;
  return output;
}

function summarizeDockerDaemonError(value) {
  const output = sanitizeDockerOutput(value, 240);
  if (/dockerDesktopLinuxEngine|npipe/i.test(output)) {
    return "could not connect to Docker Desktop Linux Engine pipe";
  }
  if (/cannot connect|failed to connect|daemon|is the docker daemon running/i.test(output)) {
    return "could not connect to Docker daemon";
  }
  return output;
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `${formatCommand(command, args)} exited with code ${code}`));
    });
  });
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

async function main() {
  const report = await runDockerPreflight({ requireDaemon: true });
  console.log(formatDockerPreflightSummary(report));
  if (report.result !== "pass") process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
