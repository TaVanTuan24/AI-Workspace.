import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../prisma.js", () => ({ prisma: { $queryRaw: vi.fn() } }));

import { prisma } from "../prisma.js";
import { dirSizeBytes, getStorageStats } from "../storageStatsService.js";

describe("dirSizeBytes", () => {
  it("sums file sizes recursively and returns 0 for a missing path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "uaiw-size-"));
    fs.writeFileSync(path.join(root, "a.txt"), "12345"); // 5 bytes
    fs.mkdirSync(path.join(root, "sub"));
    fs.writeFileSync(path.join(root, "sub", "b.txt"), "678"); // 3 bytes

    expect(dirSizeBytes(root)).toBe(8);
    expect(dirSizeBytes(path.join(root, "does-not-exist"))).toBe(0);
  });
});

describe("getStorageStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(prisma.$queryRaw).mockReset();
  });

  it("reports DB size from PRAGMA and on-disk sizes relative to cwd", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "uaiw-storage-"));
    fs.mkdirSync(path.join(root, ".data", "browser-profiles"), { recursive: true });
    fs.writeFileSync(path.join(root, ".data", "browser-profiles", "cookies"), "0123456789"); // 10 bytes
    vi.spyOn(process, "cwd").mockReturnValue(root);

    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ page_count: 10 }] as any)
      .mockResolvedValueOnce([{ page_size: 4096 }] as any);

    const stats = await getStorageStats(new Date("2026-06-28T00:00:00.000Z"));

    const db = stats.entries.find((e) => e.key === "database");
    const profiles = stats.entries.find((e) => e.key === "browserProfiles");
    expect(db?.bytes).toBe(40960);
    expect(db?.exists).toBe(true);
    expect(profiles?.bytes).toBe(10);
    expect(profiles?.exists).toBe(true);
    expect(stats.totalBytes).toBe(40960 + 10);
    expect(stats.computedAt).toBe("2026-06-28T00:00:00.000Z");
  });

  it("reports zero DB size when PRAGMA fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "uaiw-storage-"));
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("no such datasource"));

    const stats = await getStorageStats();
    const db = stats.entries.find((e) => e.key === "database");
    expect(db?.bytes).toBe(0);
    expect(db?.exists).toBe(false);
  });
});
