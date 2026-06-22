import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const root = process.cwd();
export const releaseDir = path.join(root, "dist-release");

export const forbiddenPackagePatterns = [
  /^\.env$/,
  /^\.env\..+/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.data(\/|$)/,
  /(^|\/)var(\/|$)/,
  /(^|\/)tmp(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)dist-release(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.turbo(\/|$)/,
  /(^|\/)\.vite(\/|$)/,
  /(^|\/)playwright-report(\/|$)/,
  /(^|\/)test-results(\/|$)/,
  /(^|\/)browser-profiles(\/|$)/,
  /(^|\/)storage-state(\/|$)/,
  /(^|\/)\.gemini(\/|$)/,
  /(^|\/)\.cursor(\/|$)/,
  /\.db$/,
  /\.db-journal$/,
  /\.sqlite$/,
  /\.tsbuildinfo$/
];

export const allowedEnvExamplePattern = /^\.env\.example$/;

export async function readRootPackage() {
  return JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
}

export function isValidSemver(version) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version);
}

export async function getReleaseInfo() {
  const pkg = await readRootPackage();
  const version = process.env.APP_VERSION || pkg.version || "0.0.0-dev";
  return {
    name: pkg.name || "unified-ai-workspace",
    version,
    packageVersion: pkg.version,
    dockerImages: dockerImagesForVersion(version),
    migrations: await listMigrations()
  };
}

export function dockerImagesForVersion(version) {
  return {
    api: `unified-ai-workspace-api:${version}`,
    worker: `unified-ai-workspace-worker:${version}`,
    web: `unified-ai-workspace-web:${version}`
  };
}

export async function listMigrations() {
  const migrationsDir = path.join(root, "prisma", "migrations");
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function pathExists(relativePath) {
  try {
    await fs.access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

export function shouldExclude(relativePath) {
  const normalized = normalizePath(relativePath);
  if (allowedEnvExamplePattern.test(normalized)) return false;
  return forbiddenPackagePatterns.some((pattern) => pattern.test(normalized));
}

export function normalizePath(value) {
  return value.split(path.sep).join("/");
}

export async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

export async function walkFiles(baseDir) {
  const files = [];
  await walk(baseDir, baseDir, files);
  return files.sort((a, b) => a.localeCompare(b));
}

async function walk(baseDir, currentDir, files) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relative = normalizePath(path.relative(baseDir, fullPath));
    if (shouldExclude(relative)) continue;
    if (entry.isDirectory()) {
      await walk(baseDir, fullPath, files);
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
}
