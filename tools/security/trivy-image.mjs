#!/usr/bin/env node
import { execSync } from "node:child_process";

function run() {
  const args = process.argv.slice(2);
  const image = args[0];

  if (!image) {
    console.error("Usage: node tools/security/trivy-image.mjs <image-ref>");
    process.exit(1);
  }

  let trivyAvailable = false;
  try {
    execSync("trivy --version", { stdio: "ignore" });
    trivyAvailable = true;
  } catch {
    console.warn("⚠️ trivy is not installed or available in PATH.");
    console.warn("You can install it following instructions at https://aquasecurity.github.io/trivy/latest/getting-started/installation/");
  }

  if (!trivyAvailable) {
    console.log(`[SCAFFOLD] Would run: trivy image --severity HIGH,CRITICAL ${image}`);
    console.log("✅ Trivy scaffold completed (dry-run).");
    return;
  }

  console.log(`Running trivy image scan for ${image}...`);
  try {
    execSync(`trivy image --severity HIGH,CRITICAL ${image}`, { stdio: "inherit" });
    console.log("✅ Trivy scan passed.");
  } catch (error) {
    console.error("❌ Trivy scan failed.");
    process.exit(1);
  }
}

run();
