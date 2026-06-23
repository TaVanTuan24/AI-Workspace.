#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, root, sha256File } from "./lib.mjs";
import { readDockerPreflightStatus } from "./docker-preflight.mjs";

export function parseArgs(argv) {
  const options = {
    requireCosign: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--version") {
      options.version = argv[++index];
    } else if (arg === "--release-dir") {
      options.releaseDir = argv[++index];
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
    "  corepack pnpm release:tag:dry-run --version 0.3.0 --release-dir dist-release/unified-ai-workspace-0.3.0",
    "",
    "This command does not create tags, push tags, sign artifacts, or publish images."
  ].join("\n");
}

export async function runTagDryRun(options, deps = {}) {
  if (!options?.version) throw new Error("--version is required");
  if (!options?.releaseDir) throw new Error("--release-dir is required");

  const version = options.version;
  const releaseDirPath = path.resolve(root, options.releaseDir);
  const checks = [];
  const warnings = [];
  const nextSteps = [];

  const commandExists = deps.commandExists || defaultCommandExists;
  const gitStatus = deps.gitStatus || getGitStatus;
  const readPreflightStatus = deps.readDockerPreflightStatus || readDockerPreflightStatus;

  checks.push(await check("workspace version matches target", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    return pkg.version === version ? `package.json=${pkg.version}` : fail(`package.json=${pkg.version}`);
  }));

  checks.push(await check("release dir exists", async () => pathExists(releaseDirPath)));
  checks.push(await check("release manifest exists", async () => pathExists(path.join(releaseDirPath, "release-manifest.json"))));
  checks.push(await check("SBOM exists", async () => pathExists(path.join(releaseDirPath, "sbom.cyclonedx.json"))));
  checks.push(await check("checksums verify", async () => verifyChecksums(releaseDirPath)));
  checks.push(await check(`docs/RELEASE_NOTES_${version}.md exists`, async () => pathExists(path.join(root, "docs", `RELEASE_NOTES_${version}.md`))));
  checks.push(await check("CHANGELOG.md references version", async () => fileContains(path.join(root, "CHANGELOG.md"), version)));
  checks.push(await check(`docs/UPGRADE-${version}.md exists`, async () => pathExists(path.join(root, "docs", `UPGRADE-${version}.md`))));
  checks.push(await check(`docs/RELEASE_OPERATOR_HANDOFF_${version}.md exists`, async () => {
    return pathExists(path.join(root, "docs", `RELEASE_OPERATOR_HANDOFF_${version}.md`));
  }));
  checks.push(await check("license notices doc exists", async () => pathExists(path.join(root, "docs", "THIRD_PARTY_LICENSE_NOTICES.md"))));

  const marker = await loadStagingMarker(releaseDirPath);
  if (marker.ok) {
    checks.push({ name: "staging verification marker exists", status: "pass", detail: marker.detail });
  } else {
    const preflightStatus = await readPreflightStatus();
    if (preflightStatus.ok && preflightStatus.content?.dockerDaemon === "unavailable") {
      warnings.push("Staging verification not complete because Docker daemon was unavailable.");
      nextSteps.push("docker info");
      nextSteps.push("corepack pnpm release:staging:local --preflight-only --env-file .env.staging");
    } else {
      warnings.push("Staging verification marker is missing. Run release:staging:local before tagging.");
      nextSteps.push("corepack pnpm release:staging:env --out .env.staging");
    }
    nextSteps.push(`corepack pnpm release:operator:status --version ${version} --release-dir ${normalizePath(path.relative(root, releaseDirPath))}`);
    nextSteps.push(`corepack pnpm release:staging:local --env-file .env.staging --expected-version ${version} --base-url http://localhost:4000 --down`);
    nextSteps.push(`corepack pnpm release:tag:dry-run --version ${version} --release-dir ${normalizePath(path.relative(root, releaseDirPath))}`);
    nextSteps.push(`Review docs/RELEASE_OPERATOR_HANDOFF_${version}.md`);
    checks.push({ name: "staging verification marker exists", status: "warn", detail: marker.detail });
  }

  const git = await gitStatus();
  if (git.status === "clean") {
    checks.push({ name: "working tree clean", status: "pass", detail: "clean" });
  } else if (git.status === "dirty") {
    checks.push({ name: "working tree clean", status: "warn", detail: `${git.files.length} changed files` });
    warnings.push(`Working tree is dirty: ${git.files.slice(0, 10).join(", ")}`);
  } else {
    checks.push({ name: "working tree clean", status: "warn", detail: git.reason });
    warnings.push(`Git working tree could not be checked: ${git.reason}`);
    if (git.reason === "not a git repository") {
      warnings.push("Final tag must be created manually in a real Git checkout.");
    }
  }

  const cosignAvailable = await commandExists("cosign", ["version"]);
  if (cosignAvailable) {
    checks.push({ name: "cosign available", status: "pass", detail: "available" });
  } else if (options.requireCosign) {
    checks.push({ name: "cosign available", status: "fail", detail: "missing" });
  } else {
    checks.push({ name: "cosign available", status: "warn", detail: "missing; signing remains opt-in" });
    warnings.push("cosign is not available. Install it before real signing.");
  }

  const result = checks.some((item) => item.status === "fail") ? "fail" : "pass";
  return {
    version,
    releaseDir: normalizePath(path.relative(root, releaseDirPath)),
    checks,
    warnings,
    nextSteps,
    manualCommands: [
      `git tag -a v${version} -m "Unified AI Workspace v${version}"`,
      `git push origin v${version}`
    ],
    result
  };
}

async function check(name, fn) {
  try {
    const detail = await fn();
    if (detail === true) return { name, status: "pass" };
    if (typeof detail === "string") return { name, status: "pass", detail };
    if (detail && typeof detail === "object" && detail.status) return { name, ...detail };
    return { name, status: "fail", detail: "missing or invalid" };
  } catch (error) {
    return {
      name,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function fail(detail) {
  return { status: "fail", detail };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileContains(filePath, needle) {
  const content = await fs.readFile(filePath, "utf8");
  return content.includes(needle) ? true : fail(`${normalizePath(path.relative(root, filePath))} does not reference ${needle}`);
}

async function verifyChecksums(releaseDirPath) {
  const checksumPath = path.join(releaseDirPath, "checksums.sha256");
  const content = await fs.readFile(checksumPath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return fail("checksums.sha256 is empty");

  for (const line of lines) {
    const [expectedHash, ...nameParts] = line.trim().split(/\s+/);
    const name = nameParts.join(" ");
    const filePath = path.join(releaseDirPath, name);
    const actualHash = await sha256File(filePath);
    if (actualHash !== expectedHash) return fail(`checksum mismatch: ${name}`);
  }

  return `${lines.length} entries`;
}

async function loadStagingMarker(releaseDirPath) {
  const markerPath = path.join(releaseDirPath, "staging-verification.json");
  try {
    const marker = JSON.parse(await fs.readFile(markerPath, "utf8"));
    if (marker.liveProviderLoginTests !== false || marker.chatSmoke !== false) {
      return { ok: false, detail: "marker contains unexpected live smoke flags" };
    }
    return { ok: true, detail: `verifiedAt=${marker.verifiedAt ?? "unknown"}` };
  } catch {
    return { ok: false, detail: "missing" };
  }
}

async function getGitStatus() {
  const gitDir = path.join(root, ".git");
  if (!(await pathExists(gitDir))) return { status: "unknown", reason: "not a git repository" };

  const output = await runCapture("git", ["status", "--short"]);
  const files = output.split(/\r?\n/).filter(Boolean);
  return files.length === 0 ? { status: "clean" } : { status: "dirty", files };
}

async function defaultCommandExists(command, args = ["--version"]) {
  try {
    await runCapture(command, args);
    return true;
  } catch {
    return false;
  }
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
    `Release tag dry-run for v${report.version}`,
    `Release dir: ${report.releaseDir}`,
    ""
  ];

  for (const check of report.checks) {
    const label = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    lines.push(`${label} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  if (report.nextSteps.length > 0) {
    lines.push("");
    lines.push("Next steps before tagging:");
    for (const command of report.nextSteps) lines.push(`  ${command}`);
  } else {
    lines.push("");
    lines.push("Staging marker present. Tag dry-run is ready for manual release review.");
  }

  lines.push("");
  lines.push("Manual commands only; not executed:");
  for (const command of report.manualCommands) lines.push(`  ${command}`);
  lines.push("");
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
    const report = await runTagDryRun(options);
    console.log(formatSummary(report));
    if (report.result !== "pass") process.exitCode = 1;
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
