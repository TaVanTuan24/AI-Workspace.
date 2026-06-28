#!/usr/bin/env node
// Local-first backup: snapshots the SQLite database and the .data directory
// (browser profiles + encrypted session blobs) into a timestamped folder under
// var/backups, with a metadata sidecar. Pure Node + fs, cross-platform.
//
// Secrets (.env, SESSION_MASTER_KEY) are intentionally NOT included. Session
// blobs are encrypted at rest, so restoring usable sessions requires the SAME
// SESSION_MASTER_KEY that was active when the backup was taken.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Paths relative to the repo root that make up a restorable local state.
const SOURCES = [
  { rel: "prisma/dev.db", kind: "file" },
  { rel: "prisma/dev.db-wal", kind: "file", optional: true },
  { rel: "prisma/dev.db-shm", kind: "file", optional: true },
  { rel: ".data", kind: "dir", optional: true }
];

export function parseBackupArgs(argv) {
  const options = { root: process.cwd(), out: null, label: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") options.root = argv[++i];
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--label") options.label = argv[++i];
  }
  return options;
}

function readAppVersion(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function resolveGitSha(root) {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function timestampSlug(now) {
  // 2026-06-28T14-30-05 — filesystem-safe, sortable.
  return now.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
}

export async function runBackup({ root = process.cwd(), out = null, label = null, now = new Date() } = {}) {
  const backupsRoot = out ?? path.join(root, "var", "backups");
  const slug = `uaiw-backup-${timestampSlug(now)}${label ? `-${label}` : ""}`;
  const backupDir = path.join(backupsRoot, slug);

  fs.mkdirSync(backupDir, { recursive: true });

  const copied = [];
  const skipped = [];
  for (const source of SOURCES) {
    const src = path.join(root, source.rel);
    if (!fs.existsSync(src)) {
      if (!source.optional) skipped.push({ rel: source.rel, reason: "missing (required source not found)" });
      else skipped.push({ rel: source.rel, reason: "absent" });
      continue;
    }
    const dest = path.join(backupDir, source.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: source.kind === "dir" });
    copied.push(source.rel);
  }

  const metadata = {
    format: "unified-ai-workspace.backup",
    version: 1,
    app: "Unified AI Workspace",
    appVersion: readAppVersion(root),
    gitSha: resolveGitSha(root),
    createdAt: now.toISOString(),
    contents: copied,
    skipped,
    notes: "Excludes .env and secrets. Restoring sessions requires the same SESSION_MASTER_KEY."
  };
  fs.writeFileSync(path.join(backupDir, "backup-metadata.json"), JSON.stringify(metadata, null, 2) + "\n", "utf8");

  return { backupDir, metadata };
}

// CLI entry — only runs when executed directly, not when imported by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseBackupArgs(process.argv.slice(2));
  runBackup(options)
    .then(({ backupDir, metadata }) => {
      console.log(`Backup created: ${backupDir}`);
      console.log(`  app version: ${metadata.appVersion}${metadata.gitSha ? ` (git ${metadata.gitSha})` : ""}`);
      console.log(`  contents: ${metadata.contents.join(", ") || "(none)"}`);
      if (metadata.skipped.length) {
        console.log(`  skipped: ${metadata.skipped.map((s) => `${s.rel} [${s.reason}]`).join(", ")}`);
      }
      console.log("Note: .env / SESSION_MASTER_KEY are not included; keep them safe separately.");
    })
    .catch((error) => {
      console.error("Backup failed:", error.message);
      process.exit(1);
    });
}
