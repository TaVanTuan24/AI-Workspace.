#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { getReleaseInfo, normalizePath, releaseDir, root, sha256File } from "./lib.mjs";

async function generateSbom() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const extraOutPath = outIndex >= 0 && args[outIndex + 1] ? path.resolve(args[outIndex + 1]) : null;
  const releaseInfo = await getReleaseInfo();
  const packageName = `${releaseInfo.name}-${releaseInfo.version}`;
  const targetDir = path.join(releaseDir, packageName);

  try {
    await fs.access(targetDir);
  } catch {
    console.error(`Release package directory not found at ${targetDir}`);
    console.error("Please run 'corepack pnpm release:package' first.");
    process.exit(1);
  }

  const sbomOutputFile = path.join(targetDir, "sbom.cyclonedx.json");
  
  console.log(`Generating SBOM for version ${releaseInfo.version}...`);
  try {
    // We execute cyclonedx-npm from the root context to capture all workspace dependencies
    execSync(`npx cyclonedx-npm --ignore-npm-errors --output-file "${sbomOutputFile}"`, {
      cwd: root,
      stdio: "pipe"
    });
  } catch (error) {
    console.error("\nFailed to generate SBOM.");
    console.error("Ensure @cyclonedx/cyclonedx-npm is installed: corepack pnpm add -D @cyclonedx/cyclonedx-npm -w");
    process.exit(1);
  }

  // Read and add some extra metadata if desired
  const sbomContent = await fs.readFile(sbomOutputFile, "utf8");
  const sbom = JSON.parse(sbomContent);
  // Just rewrite nicely formatted
  await fs.writeFile(sbomOutputFile, JSON.stringify(sbom, null, 2) + "\n", "utf8");

  const checksumsPath = path.join(targetDir, "checksums.sha256");
  const sbomHash = await sha256File(sbomOutputFile);
  const checksumLine = `${sbomHash}  sbom.cyclonedx.json`;
  const existingChecksums = await fs.readFile(checksumsPath, "utf8").catch(() => "");
  const checksumLines = existingChecksums
    .split("\n")
    .filter((line) => line.trim().length > 0 && !line.trim().endsWith("  sbom.cyclonedx.json"));
  checksumLines.push(checksumLine);
  await fs.writeFile(checksumsPath, `${checksumLines.join("\n")}\n`, "utf8");

  if (extraOutPath) {
    await fs.mkdir(path.dirname(extraOutPath), { recursive: true });
    await fs.copyFile(sbomOutputFile, extraOutPath);
  }

  console.log(`\nSBOM generated successfully at: ${normalizePath(path.relative(root, sbomOutputFile))}`);
  if (extraOutPath) {
    console.log(`SBOM copy written to: ${normalizePath(path.relative(root, extraOutPath))}`);
  }
  console.log(`Updated checksums: ${normalizePath(path.relative(root, checksumsPath))}`);
}

generateSbom().catch((err) => {
  console.error(err);
  process.exit(1);
});
