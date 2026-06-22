#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { getReleaseInfo, normalizePath, releaseDir, root, sha256File, shouldExclude } from "./lib.mjs";

async function verifyRelease() {
  const args = process.argv.slice(2);
  let targetDir;
  const requireSbom = args.includes("--require-sbom");
  
  const dirIndex = args.indexOf("--dir");
  if (dirIndex >= 0 && args[dirIndex + 1]) {
    targetDir = path.resolve(args[dirIndex + 1]);
  } else {
    const releaseInfo = await getReleaseInfo();
    const packageName = `${releaseInfo.name}-${releaseInfo.version}`;
    targetDir = path.join(releaseDir, packageName);
  }

  try {
    await fs.access(targetDir);
  } catch {
    console.error(`Release package directory not found at ${targetDir}`);
    process.exit(1);
  }

  console.log(`Verifying release package in ${normalizePath(path.relative(root, targetDir))}...`);

  // 1. Verify manifest
  const manifestPath = path.join(targetDir, "release-manifest.json");
  let manifest;
  try {
    const manifestContent = await fs.readFile(manifestPath, "utf8");
    manifest = JSON.parse(manifestContent);
  } catch {
    console.error("Failed to load release-manifest.json");
    process.exit(1);
  }

  let hasErrors = false;

  // 2. Verify files listed in manifest
  console.log(`Verifying ${manifest.files.length} manifest files...`);
  for (const fileDef of manifest.files) {
    const filePath = path.join(targetDir, fileDef.path);
    try {
      const hash = await sha256File(filePath);
      if (hash !== fileDef.sha256) {
        console.error(`❌ Hash mismatch: ${fileDef.path} (expected ${fileDef.sha256}, got ${hash})`);
        hasErrors = true;
      }
    } catch {
      console.error(`❌ Missing file: ${fileDef.path}`);
      hasErrors = true;
    }
  }

  // 3. Verify forbidden files are absent in the actual directory
  console.log("Verifying forbidden files absence...");
  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relative = normalizePath(path.relative(targetDir, fullPath));
      
      // Specifically check for secrets that shouldn't be packaged.
      if (
        isForbiddenEnvFile(relative) ||
        relative.endsWith(".db") ||
        relative.startsWith("browser-profiles/") ||
        relative.startsWith(".data/") ||
        relative.startsWith("var/") ||
        relative.startsWith("node_modules/")
      ) {
        console.error(`❌ Forbidden file found in package: ${relative}`);
        hasErrors = true;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  }
  await walk(targetDir);

  // 4. Verify SBOM exists
  const sbomPath = path.join(targetDir, "sbom.cyclonedx.json");
  try {
    await fs.access(sbomPath);
    console.log("✅ SBOM found: sbom.cyclonedx.json");
  } catch {
    if (requireSbom) {
      console.error("❌ SBOM missing: sbom.cyclonedx.json");
      hasErrors = true;
    } else {
      console.warn("⚠️ SBOM missing: sbom.cyclonedx.json");
    }
  }

  // 5. Verify checksums.sha256 if present
  const checksumsPath = path.join(targetDir, "checksums.sha256");
  try {
    const content = await fs.readFile(checksumsPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    console.log(`✅ checksums.sha256 found with ${lines.length} entries.`);
    for (const line of lines) {
      const [expectedHash, ...nameParts] = line.trim().split(/\s+/);
      const name = nameParts.join(" ");
      const filePath = path.join(targetDir, name);
      try {
        const hash = await sha256File(filePath);
        if (hash !== expectedHash) {
          console.error(`❌ Checksum mismatch in checksums.sha256: ${name} (expected ${expectedHash}, got ${hash})`);
          hasErrors = true;
        }
      } catch {
        console.error(`❌ Missing file referenced in checksums.sha256: ${name}`);
        hasErrors = true;
      }
    }
  } catch {
    console.warn("⚠️ checksums.sha256 missing, but it is not strictly required by verification.");
  }

  if (hasErrors) {
    console.error("\n❌ Release verification FAILED due to errors.");
    process.exit(1);
  } else {
    console.log("\n✅ Release verification PASSED.");
  }
}

function isForbiddenEnvFile(relative) {
  if (relative === ".env.example") return false;
  if (/^\.env(?:\.[A-Za-z0-9_-]+)*\.example$/.test(relative)) return false;
  return relative === ".env" || /^\.env\..+/.test(relative);
}

verifyRelease().catch((err) => {
  console.error(err);
  process.exit(1);
});
