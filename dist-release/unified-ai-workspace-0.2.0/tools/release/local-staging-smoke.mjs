#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, releaseDir, root } from "./lib.mjs";
import { redactSensitiveText, verifyStaging } from "./staging-verify.mjs";
import { generateStagingEnv } from "./staging-env.mjs";
import {
  DEFAULT_PREFLIGHT_STATUS_PATH,
  formatDockerPreflightSummary,
  runDockerPreflight,
  writeDockerPreflightStatus
} from "./docker-preflight.mjs";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export function parseArgs(argv) {
  const options = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    dryRun: false,
    skipUp: false,
    down: false,
    allowProductionLikeEnv: false,
    generateEnv: false,
    preflightOnly: false,
    logsTail: 0
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") {
      options.envFile = argv[++index];
    } else if (arg === "--expected-version") {
      options.expectedVersion = argv[++index];
    } else if (arg === "--base-url") {
      options.baseUrl = argv[++index];
    } else if (arg === "--release-dir") {
      options.releaseDir = argv[++index];
    } else if (arg === "--api-key-env") {
      options.apiKeyEnv = argv[++index];
    } else if (arg === "--local-user-id") {
      options.localUserId = argv[++index];
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++index]);
    } else if (arg === "--poll-interval-ms") {
      options.pollIntervalMs = Number(argv[++index]);
    } else if (arg === "--logs-tail") {
      options.logsTail = Number(argv[++index]);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--skip-up") {
      options.skipUp = true;
    } else if (arg === "--down") {
      options.down = true;
    } else if (arg === "--allow-production-like-env") {
      options.allowProductionLikeEnv = true;
    } else if (arg === "--generate-env") {
      options.generateEnv = true;
    } else if (arg === "--preflight-only") {
      options.preflightOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function usage() {
  return [
    "Usage:",
    "  corepack pnpm release:staging:local --env-file .env.staging --expected-version 0.2.0",
    "  corepack pnpm release:staging:local --env-file .env.staging --expected-version 0.2.0 --skip-up",
    "  corepack pnpm release:staging:local --env-file .env.staging --expected-version 0.2.0 --down",
    "  corepack pnpm release:staging:local --generate-env --env-file .env.staging --expected-version 0.2.0 --down",
    "  corepack pnpm release:staging:local --preflight-only --env-file .env.staging",
    "",
    "Safe defaults:",
    "  - Refuses .env and production-looking env file names unless --allow-production-like-env is passed.",
    "  - Runs safe staging verifier only; no provider login and no prompt submission.",
    "  - Does not print container logs unless --logs-tail is provided.",
    "  - Does not tag, push, publish, or sign."
  ].join("\n");
}

export async function runLocalStagingSmoke(options, deps = {}) {
  options = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    dryRun: false,
    skipUp: false,
    down: false,
    allowProductionLikeEnv: false,
    generateEnv: false,
    preflightOnly: false,
    logsTail: 0,
    ...options
  };
  validateRequiredOptions(options);
  const envFile = path.resolve(root, options.envFile);
  let envGenerated = false;
  if (options.generateEnv && !await pathExists(envFile)) {
    const envGenerator = deps.generateStagingEnv || generateStagingEnv;
    await envGenerator({ out: envFile });
    envGenerated = true;
  }
  await validateEnvFile(envFile, options);

  const envValues = await readEnvFile(envFile);
  const expectedVersion = options.expectedVersion || envValues.APP_VERSION || "0.2.0";
  const baseUrl = options.baseUrl || envValues.API_BASE_URL || "http://localhost:4000";
  const targetReleaseDir = path.resolve(
    root,
    options.releaseDir || path.join(releaseDir, `unified-ai-workspace-${expectedVersion}`)
  );

  const composeEnv = {
    ...process.env,
    ...envValues,
    UAIW_COMPOSE_ENV_FILE: envFile,
    APP_VERSION: envValues.APP_VERSION || expectedVersion,
    BUILD_SOURCE: envValues.BUILD_SOURCE || "local-staging"
  };

  const composeCommands = [
    ["docker", ["compose", "--env-file", envFile, "config"]],
    ...(options.skipUp ? [] : [["docker", ["compose", "--env-file", envFile, "up", "-d", "--build"]]])
  ];

  if (options.dryRun) {
    return {
      result: "dry-run",
      baseUrl: redactSensitiveText(baseUrl),
      envFile: redactEnvPath(envFile),
      commands: composeCommands.map(([cmd, args]) => formatCommand(cmd, args)),
      markerPath: normalizePath(path.relative(root, markerPath(targetReleaseDir))),
      dockerPreflight: {
        result: "skipped",
        dockerDaemon: "skipped for dry-run"
      }
    };
  }

  const runCommand = deps.runCommand || runShellCommand;
  const dockerPreflight = deps.runDockerPreflight || runDockerPreflight;
  const waitReady = deps.waitReady || waitForReady;
  const verifier = deps.verifyStaging || verifyStaging;
  const writeMarker = deps.writeMarker || writeStagingMarker;
  const writePreflightStatus = deps.writeDockerPreflightStatus || writeDockerPreflightStatus;

  const preflightReport = await dockerPreflight({ requireDaemon: true }, deps.dockerPreflightDeps || {});
  const markerExists = await pathExists(markerPath(targetReleaseDir));
  const status = await writePreflightStatus(preflightReport, {
    markerGenerated: markerExists,
    statusPath: deps.preflightStatusPath
  });

  if (options.preflightOnly) {
    return {
      result: preflightReport.result === "pass" ? "preflight-pass" : "preflight-fail",
      envFile: redactEnvPath(envFile),
      statusPath: normalizePath(path.relative(root, status.path)),
      dockerPreflight: preflightReport
    };
  }

  if (preflightReport.result !== "pass") {
    throw new Error(formatStagingResumeGuidance({
      envFile,
      targetReleaseDir,
      markerExists,
      preflightReport
    }));
  }

  try {
    for (const [cmd, args] of composeCommands) {
      await runCommand(cmd, args, { env: composeEnv });
    }

    await waitReady(baseUrl, {
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs
    });

    const report = await verifier({
      baseUrl,
      expectedVersion,
      apiKeyEnv: options.apiKeyEnv,
      localUserId: options.localUserId,
      timeoutMs: 10_000
    });

    if (report.result !== "pass") {
      throw new Error("Staging verifier failed.");
    }

    const marker = await writeMarker(targetReleaseDir, {
      version: expectedVersion,
      baseUrl: redactSensitiveText(baseUrl),
      checksPassed: report.checks.filter((check) => check.status === "pass").map((check) => check.name),
      envGenerated
    });

    if (options.down) {
      await runCommand("docker", ["compose", "--env-file", envFile, "down"], { env: composeEnv });
    }

    return {
      result: "pass",
      baseUrl: redactSensitiveText(baseUrl),
      markerPath: normalizePath(path.relative(root, marker.path)),
      checksPassed: marker.content.checksPassed,
      envGenerated: marker.content.envGenerated
    };
  } catch (error) {
    if (options.logsTail > 0) {
      await printRedactedLogs(runCommand, envFile, composeEnv, options.logsTail).catch(() => undefined);
    }
    throw error;
  }
}

function validateRequiredOptions(options) {
  if (!options?.envFile) throw new Error("--env-file is required");
  if (!options?.preflightOnly && !options?.expectedVersion) throw new Error("--expected-version is required");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
}

export async function validateEnvFile(envFile, options = {}) {
  const base = path.basename(envFile).toLowerCase();
  if (!options.allowProductionLikeEnv && base === ".env") {
    throw new Error("Refusing to run local staging smoke with .env. Use .env.staging.");
  }
  if (!options.allowProductionLikeEnv && /(^|[._-])(prod|production)([._-]|$)/i.test(base)) {
    throw new Error(`Refusing production-looking env file: ${redactEnvPath(envFile)}`);
  }

  try {
    await fs.access(envFile);
  } catch {
    throw new Error(`Env file not found: ${redactEnvPath(envFile)}`);
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readEnvFile(envFile) {
  const content = await fs.readFile(envFile, "utf8");
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
    values[key] = value;
  }

  return values;
}

export async function waitForReady(baseUrl, options) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  let lastError = "not checked yet";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(new URL("/ready", baseUrl));
      const json = await response.json().catch(() => ({}));
      if (response.ok && json?.ok === true) return;
      lastError = `/ready returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timed out waiting for /ready at ${redactSensitiveText(baseUrl)}: ${redactSensitiveText(lastError)}`);
}

export async function writeStagingMarker(targetReleaseDir, details) {
  await fs.mkdir(targetReleaseDir, { recursive: true });
  const content = {
    version: details.version,
    verifiedAt: new Date().toISOString(),
    baseUrl: details.baseUrl,
    checksPassed: details.checksPassed,
    chatSmoke: false,
    liveProviderLoginTests: false,
    envGenerated: Boolean(details.envGenerated)
  };
  const pathToMarker = markerPath(targetReleaseDir);
  await fs.writeFile(pathToMarker, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  return { path: pathToMarker, content };
}

function markerPath(targetReleaseDir) {
  return path.join(targetReleaseDir, "staging-verification.json");
}

function runShellCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: options.env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stdout.on("data", (chunk) => process.stdout.write(redactSensitiveText(String(chunk))));
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      process.stderr.write(redactSensitiveText(String(chunk)));
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${formatCommand(command, args)} exited with code ${code}: ${redactSensitiveText(stderr).slice(-800)}`));
    });
  });
}

async function printRedactedLogs(runCommand, envFile, env, tail) {
  console.error(`Printing redacted docker compose logs tail=${tail}...`);
  await runCommand("docker", ["compose", "--env-file", envFile, "logs", `--tail=${tail}`], { env });
}

function formatCommand(command, args) {
  return [command, ...args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))].join(" ");
}

function redactEnvPath(envFile) {
  return normalizePath(path.relative(root, envFile)) || path.basename(envFile);
}

export function formatSummary(report) {
  if (report.result === "dry-run") {
    return [
      "Local staging smoke dry-run:",
      `Env file: ${report.envFile}`,
      `Base URL: ${report.baseUrl}`,
      `Docker daemon preflight: ${report.dockerPreflight.dockerDaemon}`,
      "Commands:",
      ...report.commands.map((command) => `  ${command}`),
      `Marker: ${report.markerPath}`
    ].join("\n");
  }

  if (report.result === "preflight-pass" || report.result === "preflight-fail") {
    return [
      report.result === "preflight-pass" ? "Local staging preflight passed." : "Local staging preflight failed.",
      `Env file: ${report.envFile}`,
      `Status: ${report.statusPath || normalizePath(path.relative(root, DEFAULT_PREFLIGHT_STATUS_PATH))}`,
      "",
      formatDockerPreflightSummary(report.dockerPreflight)
    ].join("\n");
  }

  return [
    "Local staging smoke passed.",
    `Base URL: ${report.baseUrl}`,
    `Marker: ${report.markerPath}`,
    `Env generated: ${report.envGenerated ? "yes" : "no"}`,
    `Checks passed: ${report.checksPassed.join(", ")}`
  ].join("\n");
}

function formatStagingResumeGuidance({ envFile, targetReleaseDir, markerExists, preflightReport }) {
  return [
    "Docker preflight failed; local staging smoke did not run.",
    "",
    formatDockerPreflightSummary(preflightReport),
    "",
    "Current status:",
    `- Env file exists: ${redactEnvPath(envFile)}`,
    `- Release package exists: ${normalizePath(path.relative(root, targetReleaseDir))}`,
    `- Staging marker: ${markerExists ? "present" : "missing"}`,
    "- Docker daemon: unavailable",
    "",
    "Resume commands:",
    "  docker info",
    "  corepack pnpm release:staging:local --env-file .env.staging --expected-version 0.2.0 --base-url http://localhost:4000 --down",
    "  corepack pnpm release:tag:dry-run --version 0.2.0 --release-dir dist-release/unified-ai-workspace-0.2.0"
  ].join("\n");
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const report = await runLocalStagingSmoke(options);
    console.log(formatSummary(report));
    if (report.result === "preflight-fail") process.exitCode = 1;
  } catch (error) {
    console.error(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
