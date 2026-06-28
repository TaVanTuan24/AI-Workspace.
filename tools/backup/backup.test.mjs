import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBackup } from "./backup.mjs";
import { runRestore } from "./restore.mjs";

const FIXED_NOW = new Date("2026-06-28T14:30:05.000Z");

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uaiw-backup-"));
  fs.mkdirSync(path.join(root, "prisma"), { recursive: true });
  fs.writeFileSync(path.join(root, "prisma", "dev.db"), "SQLITE-DB-BYTES");
  fs.mkdirSync(path.join(root, ".data", "browser-profiles", "gemini"), { recursive: true });
  fs.writeFileSync(path.join(root, ".data", "browser-profiles", "gemini", "cookies"), "COOKIES");
  fs.mkdirSync(path.join(root, ".data", "session-blobs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".data", "session-blobs", "claude.json"), "{}");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.3.0" }));
  return root;
}

test("backup snapshots db + .data with metadata", async () => {
  const root = makeRoot();
  const { backupDir, metadata } = await runBackup({ root, now: FIXED_NOW });

  assert.ok(fs.existsSync(backupDir), "backup dir created");
  assert.ok(backupDir.includes("uaiw-backup-2026-06-28T14-30-05"), "timestamped slug");
  assert.equal(fs.readFileSync(path.join(backupDir, "prisma", "dev.db"), "utf8"), "SQLITE-DB-BYTES");
  assert.equal(
    fs.readFileSync(path.join(backupDir, ".data", "browser-profiles", "gemini", "cookies"), "utf8"),
    "COOKIES"
  );
  assert.equal(metadata.appVersion, "0.3.0");
  assert.deepEqual(metadata.contents.sort(), ["prisma/dev.db", ".data"].sort());
  assert.ok(fs.existsSync(path.join(backupDir, "backup-metadata.json")));
});

test("restore round-trips into a clean root", async () => {
  const source = makeRoot();
  const { backupDir } = await runBackup({ root: source, now: FIXED_NOW });

  const target = fs.mkdtempSync(path.join(os.tmpdir(), "uaiw-restore-"));
  const result = await runRestore({ from: backupDir, root: target, now: FIXED_NOW });

  assert.equal(result.dryRun, false);
  assert.equal(fs.readFileSync(path.join(target, "prisma", "dev.db"), "utf8"), "SQLITE-DB-BYTES");
  assert.equal(
    fs.readFileSync(path.join(target, ".data", "session-blobs", "claude.json"), "utf8"),
    "{}"
  );
  assert.equal(result.safetyBackupDir, null, "no safety snapshot needed for a clean root");
});

test("restore refuses to overwrite without --force", async () => {
  const root = makeRoot();
  const { backupDir } = await runBackup({ root, now: FIXED_NOW });
  await assert.rejects(() => runRestore({ from: backupDir, root, force: false }), /Refusing to overwrite/);
});

test("restore --force takes a pre-restore safety snapshot then overwrites", async () => {
  const root = makeRoot();
  const { backupDir } = await runBackup({ root, now: FIXED_NOW });

  // Mutate live state so we can prove the snapshot captured it before overwrite.
  fs.writeFileSync(path.join(root, "prisma", "dev.db"), "LIVE-CHANGED");
  const result = await runRestore({ from: backupDir, root, force: true, now: FIXED_NOW });

  assert.ok(result.safetyBackupDir, "safety snapshot taken");
  assert.equal(
    fs.readFileSync(path.join(result.safetyBackupDir, "prisma", "dev.db"), "utf8"),
    "LIVE-CHANGED",
    "safety snapshot captured the live state"
  );
  assert.equal(fs.readFileSync(path.join(root, "prisma", "dev.db"), "utf8"), "SQLITE-DB-BYTES", "restored from backup");
});

test("dry-run reports conflicts without writing", async () => {
  const root = makeRoot();
  const { backupDir } = await runBackup({ root, now: FIXED_NOW });
  fs.writeFileSync(path.join(root, "prisma", "dev.db"), "LIVE");

  const result = await runRestore({ from: backupDir, root, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.ok(result.conflicts.includes("prisma/dev.db"));
  assert.equal(fs.readFileSync(path.join(root, "prisma", "dev.db"), "utf8"), "LIVE", "unchanged on dry-run");
});

test("rejects a directory that is not a backup", async () => {
  const notBackup = fs.mkdtempSync(path.join(os.tmpdir(), "uaiw-nb-"));
  await assert.rejects(() => runRestore({ from: notBackup, root: notBackup }), /Not a valid backup/);
});
