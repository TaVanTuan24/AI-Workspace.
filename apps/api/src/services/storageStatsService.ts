import fs from "node:fs";
import path from "node:path";
import { prisma } from "./prisma.js";
import { env } from "../config/env.js";

export interface StorageEntry {
  key: string;
  label: string;
  path: string;
  bytes: number;
  exists: boolean;
}

export interface StorageStats {
  entries: StorageEntry[];
  totalBytes: number;
  computedAt: string;
}

/**
 * Recursive on-disk size of a file or directory, in bytes. Best-effort:
 * unreadable entries are skipped rather than throwing, so a transient
 * permission error never breaks the stats endpoint.
 */
export function dirSizeBytes(target: string): number {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return 0;
  }
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;

  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    total += dirSizeBytes(path.join(target, entry.name));
  }
  return total;
}

/**
 * SQLite database size via PRAGMA, independent of where the file lives on disk
 * (the Prisma client resolves the path relative to the schema, not cwd).
 * Returns 0 on any error or for non-SQLite datasources.
 */
async function databaseSizeBytes(): Promise<number> {
  try {
    const pageCount = await prisma.$queryRaw<Array<Record<string, number | bigint>>>`PRAGMA page_count`;
    const pageSize = await prisma.$queryRaw<Array<Record<string, number | bigint>>>`PRAGMA page_size`;
    const count = Number(Object.values(pageCount[0] ?? {})[0] ?? 0);
    const size = Number(Object.values(pageSize[0] ?? {})[0] ?? 0);
    return count * size;
  } catch {
    return 0;
  }
}

export async function getStorageStats(now: Date = new Date()): Promise<StorageStats> {
  const entries: StorageEntry[] = [];

  const dbBytes = await databaseSizeBytes();
  entries.push({
    key: "database",
    label: "SQLite database",
    path: "prisma/dev.db",
    bytes: dbBytes,
    exists: dbBytes > 0
  });

  // Filesystem targets are interpreted relative to cwd, matching how the rest
  // of the app resolves these env paths (e.g. browserManager profile root).
  const fsTargets = [
    { key: "browserProfiles", label: "Browser profiles", rel: env.BROWSER_PROFILE_ROOT },
    { key: "sessionBlobs", label: "Encrypted session blobs", rel: env.SESSION_BLOB_ROOT },
    { key: "backups", label: "Local backups", rel: path.join("var", "backups") }
  ];
  for (const target of fsTargets) {
    const abs = path.resolve(process.cwd(), target.rel);
    const exists = fs.existsSync(abs);
    entries.push({
      key: target.key,
      label: target.label,
      path: target.rel,
      bytes: exists ? dirSizeBytes(abs) : 0,
      exists
    });
  }

  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return { entries, totalBytes, computedAt: now.toISOString() };
}
