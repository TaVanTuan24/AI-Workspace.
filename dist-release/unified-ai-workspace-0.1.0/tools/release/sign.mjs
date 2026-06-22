#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getReleaseInfo, normalizePath, releaseDir, root } from "./lib.mjs";

async function signRelease() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  const releaseInfo = await getReleaseInfo();
  const packageName = `${releaseInfo.name}-${releaseInfo.version}`;
  const targetDir = path.join(releaseDir, packageName);

  try {
    await fs.access(targetDir);
  } catch {
    console.error(`Release package directory not found at ${targetDir}`);
    process.exit(1);
  }

  const checksumsPath = path.join(targetDir, "checksums.sha256");
  try {
    await fs.access(checksumsPath);
  } catch {
    console.error("No checksums.sha256 found to sign. Please package the release first.");
    process.exit(1);
  }

  console.log(`Signing release package in ${normalizePath(path.relative(root, targetDir))}...`);

  // Check if cosign is installed
  let cosignAvailable = false;
  try {
    execSync("cosign version", { stdio: "ignore" });
    cosignAvailable = true;
  } catch {
    console.warn("⚠️ cosign is not installed or available in PATH.");
    console.warn("You can install it following the instructions at https://docs.sigstore.dev/cosign/installation/");
  }

  if (isDryRun) {
    console.log("\n[DRY-RUN] Would sign checksums.sha256 using cosign...");
    if (!cosignAvailable) {
      console.log("[DRY-RUN] cosign is missing, but this is a dry-run.");
    }
    console.log("[DRY-RUN] Command: cosign sign-blob checksums.sha256 --output-signature checksums.sha256.sig");
    console.log("\n✅ Signing scaffold dry-run complete.");
    return;
  }

  if (!cosignAvailable) {
    console.error("❌ Cannot sign without cosign available. Run with --dry-run to test scaffold.");
    process.exit(1);
  }

  try {
    console.log("Running keyless signing via Sigstore OIDC...");
    // Keyless signing uses OIDC, typical in GH Actions
    execSync(`cosign sign-blob checksums.sha256 --yes --output-signature checksums.sha256.sig`, {
      cwd: targetDir,
      stdio: "inherit"
    });
    console.log("\n✅ Signed checksums.sha256 successfully.");
  } catch (error) {
    console.error("❌ Signing failed. Ensure OIDC token available or key is provided.");
    process.exit(1);
  }
}

signRelease().catch((err) => {
  console.error(err);
  process.exit(1);
});
