#!/usr/bin/env node
// Restore a local backup created by backup.mjs. Copies the snapshot's
// prisma/dev.db* and .data back into the repo root. Refuses to overwrite
// existing state unless --force, and when forcing it first snapshots the
// current state to var/backups/pre-restore-<ts> so a restore is reversible.
//
// Stop the API/worker before restoring so nothing holds the SQLite file open.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBackup } from "./backup.mjs";

const RESTORE_RELS = ["prisma/dev.db", "prisma/dev.db-wal", "prisma/dev.db-shm", ".data"];

export function parseRestoreArgs(argv) {
  const options = { from: null, root: process.cwd(), force: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") options.from = argv[++i];
    else if (arg === "--root") options.root = argv[++i];
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
  }
  return options;
}

export async function runRestore({ from, root = process.cwd(), force = false, dryRun = false, now = new Date() } = {}) {
  if (!from) throw new Error("Missing --from <backupDir>.");
  const backupDir = path.resolve(from);

  const metadataPath = path.join(backupDir, "backup-metadata.json");
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Not a valid backup: ${metadataPath} not found.`);
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

  // Which backed-up paths are actually present in the snapshot.
  const present = RESTORE_RELS.filter((rel) => fs.existsSync(path.join(backupDir, rel)));
  if (present.length === 0) {
    throw new Error("Backup contains no restorable files.");
  }

  // Targets that already exist in the destination root.
  const conflicts = present.filter((rel) => fs.existsSync(path.join(root, rel)));

  if (dryRun) {
    return { dryRun: true, backupDir, metadata, willRestore: present, conflicts, safetyBackupDir: null };
  }

  if (conflicts.length > 0 && !force) {
    throw new Error(
      `Refusing to overwrite existing state (${conflicts.join(", ")}). Re-run with --force to replace it (a pre-restore snapshot is taken automatically).`
    );
  }

  // Safety net: snapshot current state before a forced overwrite.
  let safetyBackupDir = null;
  if (conflicts.length > 0) {
    const safety = await runBackup({ root, label: "pre-restore", now });
    safetyBackupDir = safety.backupDir;
  }

  for (const rel of present) {
    const src = path.join(backupDir, rel);
    const dest = path.join(root, rel);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: fs.statSync(src).isDirectory() });
  }

  return { dryRun: false, backupDir, metadata, restored: present, conflicts, safetyBackupDir };
}

// CLI entry.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseRestoreArgs(process.argv.slice(2));
  runRestore(options)
    .then((result) => {
      if (result.dryRun) {
        console.log(`[DRY RUN] Would restore from ${result.backupDir}`);
        console.log(`  files: ${result.willRestore.join(", ")}`);
        if (result.conflicts.length) console.log(`  would overwrite: ${result.conflicts.join(", ")} (needs --force)`);
        return;
      }
      if (result.safetyBackupDir) console.log(`Pre-restore snapshot saved: ${result.safetyBackupDir}`);
      console.log(`Restored from ${result.backupDir}`);
      console.log(`  files: ${result.restored.join(", ")}`);
      console.log("Restart the API/worker. Sessions decrypt only with the matching SESSION_MASTER_KEY.");
    })
    .catch((error) => {
      console.error("Restore failed:", error.message);
      process.exit(1);
    });
}
