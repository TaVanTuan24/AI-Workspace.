#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  getReleaseInfo,
  normalizePath,
  releaseDir,
  root,
  sha256File,
  shouldExclude,
  walkFiles
} from "./lib.mjs";

const releaseInfo = await getReleaseInfo();
const packageName = `${releaseInfo.name}-${releaseInfo.version}`;
const targetDir = path.join(releaseDir, packageName);

await fs.rm(targetDir, { recursive: true, force: true });
await fs.mkdir(targetDir, { recursive: true });

const sourceFiles = await walkFiles(root);
const copiedFiles = [];

for (const relativePath of sourceFiles) {
  if (shouldExclude(relativePath)) continue;
  const sourcePath = path.join(root, relativePath);
  const targetPath = path.join(targetDir, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  copiedFiles.push(relativePath);
}

const manifestFiles = [];
for (const relativePath of copiedFiles.sort((a, b) => a.localeCompare(b))) {
  const filePath = path.join(targetDir, relativePath);
  manifestFiles.push({
    path: normalizePath(relativePath),
    sha256: await sha256File(filePath)
  });
}

const manifest = {
  name: releaseInfo.name,
  version: releaseInfo.version,
  createdAt: new Date().toISOString(),
  packageType: "source",
  files: manifestFiles,
  migrations: releaseInfo.migrations,
  dockerImages: releaseInfo.dockerImages,
  safety: {
    includesEnvExampleOnly: true,
    excludesNodeModules: true,
    excludesDatabases: true,
    excludesBrowserProfiles: true,
    excludesProviderSessions: true,
    excludesSmokeReports: true
  }
};

await fs.writeFile(
  path.join(targetDir, "release-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(`Created release package: ${normalizePath(path.relative(root, targetDir))}`);
console.log(`Files: ${manifestFiles.length}`);
console.log(`Manifest: ${normalizePath(path.relative(root, path.join(targetDir, "release-manifest.json")))}`);

// Generate checksums.sha256
const manifestSha256 = await sha256File(path.join(targetDir, "release-manifest.json"));
const checksumLines = manifestFiles.map(f => `${f.sha256}  ${f.path}`);
checksumLines.push(`${manifestSha256}  release-manifest.json`);
await fs.writeFile(
  path.join(targetDir, "checksums.sha256"),
  checksumLines.join("\n") + "\n",
  "utf8"
);
console.log(`Checksums: ${normalizePath(path.relative(root, path.join(targetDir, "checksums.sha256")))}`);
