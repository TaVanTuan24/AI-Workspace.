#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, root } from "./lib.mjs";
import { readDockerPreflightStatus } from "./docker-preflight.mjs";

const DEFAULT_ENV_FILE = ".env.staging";
const HANDOFF_DOC = "docs/RELEASE_OPERATOR_HANDOFF_0.2.0.md";

export function parseArgs(argv) {
  const options = {
    strict: false,
    requireCosign: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--version") {
      options.version = argv[++index];
    } else if (arg === "--release-dir") {
      options.releaseDir = argv[++index];
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--require-cosign") {
      options.requireCosign = true;
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
    "  corepack pnpm release:operator:status --version 0.2.0 --release-dir dist-release/unified-ai-workspace-0.2.0",
    "  corepack pnpm release:operator:status --version 0.2.0 --release-dir dist-release/unified-ai-workspace-0.2.0 --strict --require-cosign",
    "",
    "This command reports release handoff status only. It does not tag, push, sign, publish, run provider logins, or print secrets."
  ].join("\n");
}

export async function runOperatorStatus(options, deps = {}) {
  if (!options?.version) throw new Error("--version is required");
  if (!options?.releaseDir) throw new Error("--release-dir is required");

  const version = options.version;
  const releaseDirPath = path.resolve(root, options.releaseDir);
  const commandExists = deps.commandExists || defaultCommandExists;
  const gitStatus = deps.gitStatus || getGitStatus;
  const readPreflightStatus = deps.readDockerPreflightStatus || readDockerPreflightStatus;
  const envFile = deps.envFile || path.join(root, DEFAULT_ENV_FILE);
  const rows = [];

  const pkg = await readJson(path.join(root, "package.json")).catch(() => undefined);
  add(rows, "workspace version", pkg?.version === version ? "pass" : "fail", `package.json=${pkg?.version ?? "missing"}`);

  const releaseDirExists = await pathExists(releaseDirPath);
  add(rows, "release dir", releaseDirExists ? "pass" : "fail", normalizePath(path.relative(root, releaseDirPath)));
  add(rows, "release manifest", await pathExists(path.join(releaseDirPath, "release-manifest.json")) ? "pass" : "fail");
  add(rows, "checksums", await pathExists(path.join(releaseDirPath, "checksums.sha256")) ? "pass" : "fail");
  add(rows, "SBOM", await pathExists(path.join(releaseDirPath, "sbom.cyclonedx.json")) ? "pass" : "fail");

  const markerExists = await pathExists(path.join(releaseDirPath, "staging-verification.json"));
  add(rows, "staging marker", markerExists ? "pass" : "blocked", markerExists ? "present" : "missing");

  const cosignAvailable = await commandExists("cosign", ["version"]);
  add(rows, "cosign", cosignAvailable ? "pass" : (options.requireCosign ? "fail" : "warn"), cosignAvailable ? "available" : "missing");

  const git = await gitStatus();
  if (git.status === "clean") {
    add(rows, "git checkout", "pass", "clean");
  } else if (git.status === "dirty") {
    add(rows, "git checkout", "warn", `${git.files.length} changed files`);
  } else {
    add(rows, "git checkout", "warn", git.reason || "not available");
  }

  const envExists = await pathExists(envFile);
  const envIgnored = envExists ? await isPathGitignored(path.relative(root, envFile)) : false;
  add(rows, ".env.staging", envExists && envIgnored ? "pass" : envExists ? "warn" : "blocked", envExists ? (envIgnored ? "exists and gitignored" : "exists but gitignore coverage not confirmed") : "missing");

  const preflight = await readPreflightStatus();
  add(rows, "docker preflight status", preflight.ok ? statusFromPreflight(preflight.content) : "warn", preflight.ok ? preflightDetail(preflight.content) : "not found");

  for (const docPath of [
    "docs/THIRD_PARTY_LICENSE_NOTICES.md",
    "docs/UPGRADE-0.2.0.md",
    "docs/RELEASE_TAG_CHECKLIST_0.2.0.md",
    HANDOFF_DOC
  ]) {
    add(rows, docPath, await pathExists(path.join(root, docPath)) ? "pass" : "fail");
  }

  const strictFailures = rows.filter((row) => row.status === "fail" || (options.strict && row.status === "blocked"));
  const blocked = rows.some((row) => row.status === "blocked");
  const result = strictFailures.length > 0 ? "fail" : blocked ? "blocked" : "pass";

  return {
    version,
    releaseDir: normalizePath(path.relative(root, releaseDirPath)),
    strict: Boolean(options.strict),
    requireCosign: Boolean(options.requireCosign),
    rows,
    nextAction: nextAction({ rows, preflight, markerExists, cosignAvailable, git, version }),
    result
  };
}

function add(rows, name, status, detail = "") {
  rows.push({ name, status, detail });
}

function statusFromPreflight(content) {
  if (content?.dockerDaemon === "unavailable") return "blocked";
  if (content?.dockerDaemon === "ok") return "pass";
  return "warn";
}

function preflightDetail(content) {
  return `daemon=${content?.dockerDaemon ?? "unknown"} markerGenerated=${Boolean(content?.markerGenerated)}`;
}

function nextAction({ rows, preflight, markerExists, cosignAvailable, git, version }) {
  if (rows.some((row) => row.name === "release dir" && row.status === "fail")) {
    return "Run `corepack pnpm release:package` and `corepack pnpm release:sbom --out dist-release/sbom.cyclonedx.json`.";
  }
  if (rows.some((row) => row.name === "workspace version" && row.status === "fail")) {
    return "Align package.json version with the requested release version before continuing.";
  }
  if (rows.some((row) => row.name === ".env.staging" && row.status === "blocked")) {
    return "Run `corepack pnpm release:staging:env --out .env.staging`, then inspect it locally without pasting secrets.";
  }
  if (!markerExists && preflight.ok && preflight.content?.dockerDaemon === "unavailable") {
    return "Start Docker Desktop/Linux Engine, wait for `docker info`, then rerun `corepack pnpm release:staging:local --env-file .env.staging --expected-version 0.2.0 --base-url http://localhost:4000 --down`.";
  }
  if (!markerExists) {
    return "Run real local staging smoke to generate `staging-verification.json`.";
  }
  if (!cosignAvailable) {
    return "Install/verify cosign or rerun tag dry-run without `--require-cosign` if signing remains optional.";
  }
  if (git.status === "unknown") {
    return "Open a real Git checkout before creating the manual tag.";
  }
  if (git.status === "dirty") {
    return "Review and commit or intentionally handle local changes before tagging.";
  }
  return `Run final dry-run, then manually tag v${version} if release policy is satisfied.`;
}

async function isPathGitignored(relativePath) {
  const content = await fs.readFile(path.join(root, ".gitignore"), "utf8").catch(() => "");
  const normalized = normalizePath(relativePath);
  const base = path.basename(normalized);
  let ignored = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    const pattern = negate ? line.slice(1) : line;
    const matches =
      pattern === normalized ||
      pattern === base ||
      (pattern === ".env.*" && /^\.env\..+/.test(base)) ||
      (pattern === "!.env.*.example" && /^\.env\..+\.example$/.test(base)) ||
      (pattern.endsWith("/") && normalized.startsWith(pattern));
    if (matches) ignored = !negate;
  }

  return ignored;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function defaultCommandExists(command, args = ["--version"]) {
  try {
    await runCapture(command, args);
    return true;
  } catch {
    return false;
  }
}

async function getGitStatus() {
  if (!await pathExists(path.join(root, ".git"))) return { status: "unknown", reason: "not a git repository" };
  const output = await runCapture("git", ["status", "--short"]);
  const files = output.split(/\r?\n/).filter(Boolean);
  return files.length === 0 ? { status: "clean" } : { status: "dirty", files };
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
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

export function formatSummary(report) {
  const lines = [
    `Release operator status for v${report.version}`,
    `Release dir: ${report.releaseDir}`,
    `Mode: ${report.strict ? "strict" : "advisory"}${report.requireCosign ? " + require-cosign" : ""}`,
    "",
    "Status  Check                                  Detail"
  ];

  for (const row of report.rows) {
    lines.push(`${row.status.toUpperCase().padEnd(7)} ${row.name.padEnd(38)} ${row.detail || ""}`.trimEnd());
  }

  lines.push("");
  lines.push(`Next action: ${report.nextAction}`);
  lines.push(`Result: ${report.result.toUpperCase()}`);
  return lines.join("\n");
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const report = await runOperatorStatus(options);
    console.log(formatSummary(report));
    if (report.result === "fail") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
