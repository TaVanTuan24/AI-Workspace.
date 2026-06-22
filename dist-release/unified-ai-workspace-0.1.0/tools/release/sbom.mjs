#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { getReleaseInfo, normalizePath, releaseDir, root } from "./lib.mjs";

async function generateSbom() {
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
      stdio: "inherit"
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

  console.log(`\nSBOM generated successfully at: ${normalizePath(path.relative(root, sbomOutputFile))}`);
}

generateSbom().catch((err) => {
  console.error(err);
  process.exit(1);
});
