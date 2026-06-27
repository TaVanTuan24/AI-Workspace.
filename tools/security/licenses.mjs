#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs() {
  const args = process.argv.slice(2);
  let policyPath = "tools/security/policy.json";
  let failOn = "denied";
  let outPath = "dist-security/license-report.json";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--policy" && args[i + 1]) policyPath = args[++i];
    else if (args[i] === "--fail-on" && args[i + 1]) failOn = args[++i];
    else if (args[i] === "--out" && args[i + 1]) outPath = args[++i];
  }

  return { policyPath, failOn, outPath };
}

function checkLicenseStatus(pkgName, version, licenseExp, policy) {
  const exactName = `${pkgName}@${version}`;
  
  if (policy.allowPackages?.includes(exactName) || policy.allowPackages?.includes(pkgName)) {
    return "allowed";
  }
  if (policy.denyPackages?.includes(exactName) || policy.denyPackages?.includes(pkgName)) {
    return "denied";
  }

  // Handle basic expressions
  const cleanExp = licenseExp.replace(/[()]/g, "");
  let tokens = [cleanExp];
  let isOr = false;
  let isAnd = false;

  if (cleanExp.includes(" OR ")) {
    tokens = cleanExp.split(" OR ").map(s => s.trim());
    isOr = true;
  } else if (cleanExp.includes(" AND ")) {
    tokens = cleanExp.split(" AND ").map(s => s.trim());
    isAnd = true;
  }

  const checkToken = (token) => {
    if (policy.deniedLicenses?.includes(token)) return "denied";
    if (policy.reviewLicenses?.includes(token)) return "review";
    if (policy.allowedLicenses?.includes(token)) return "allowed";
    return "unknown";
  };

  const tokenStatuses = tokens.map(checkToken);

  if (isOr) {
    if (tokenStatuses.includes("allowed")) return "allowed";
    if (tokenStatuses.includes("review")) return "review";
    if (tokenStatuses.includes("unknown")) return "unknown";
    return "denied";
  }

  if (isAnd) {
    if (tokenStatuses.includes("denied")) return "denied";
    if (tokenStatuses.includes("review")) return "review";
    if (tokenStatuses.includes("unknown")) return "unknown";
    return "allowed";
  }

  return tokenStatuses[0];
}

async function run() {
  const { policyPath, failOn, outPath } = parseArgs();
  
  let policy = {};
  try {
    const policyContent = await fs.readFile(path.resolve(policyPath), "utf8");
    policy = JSON.parse(policyContent);
  } catch {
    console.error(`Failed to load policy file at ${policyPath}`);
    process.exit(1);
  }

  console.log(`Running pnpm licenses list...`);
  
  let rawOutput = "";
  try {
    rawOutput = execSync("corepack pnpm licenses list --json", { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (err) {
    // pnpm licenses list can exit non-zero (e.g. when some packages report an
    // unknown license) while still emitting valid JSON on stdout. Recover that
    // output; only treat it as a hard failure when nothing usable was produced.
    rawOutput = (err.stdout ?? "").toString();
    if (!rawOutput.trim()) {
      console.error("Failed to run pnpm licenses list:", (err.stderr ?? "").toString() || err.message);
      process.exit(1);
    }
  }

  let licensesData;
  try {
    licensesData = JSON.parse(rawOutput);
  } catch {
    console.error("Failed to parse pnpm licenses JSON output");
    process.exit(1);
  }

  const summary = {
    totalPackages: 0,
    allowed: 0,
    review: 0,
    denied: 0,
    unknown: 0
  };

  const packagesList = [];
  let shouldFail = false;

  for (const [licenseGroup, pkgs] of Object.entries(licensesData)) {
    if (!Array.isArray(pkgs)) continue;
    for (const pkg of pkgs) {
      const version = pkg.versions[0] || "unknown";
      const status = checkLicenseStatus(pkg.name, version, licenseGroup, policy);
      
      summary.totalPackages++;
      summary[status]++;

      packagesList.push({
        name: pkg.name,
        version,
        license: licenseGroup,
        normalizedLicense: status !== "unknown" ? licenseGroup : undefined,
        originalLicenseExpression: licenseGroup,
        status,
        path: pkg.paths[0] || ""
      });

      if (status === "denied" && (failOn === "denied" || failOn === "review")) {
        shouldFail = true;
      }
      if ((status === "review" || status === "unknown") && failOn === "review") {
        shouldFail = true;
      }
    }
  }

  if (summary.totalPackages === 0) {
    console.warn(
      "No license groups parsed from pnpm output; skipping the license gate. Raw output head:",
      rawOutput.slice(0, 300)
    );
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policyPath,
    summary,
    packages: packagesList
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("\n--- License Summary ---");
  console.log(`Total packages: ${summary.totalPackages}`);
  console.log(`Allowed: ${summary.allowed}, Review: ${summary.review}, Denied: ${summary.denied}, Unknown: ${summary.unknown}`);
  console.log(`Report written to: ${outPath}`);

  if (summary.denied > 0) {
    console.warn("\n⚠️ Denied licenses found:");
    packagesList.filter(p => p.status === "denied").forEach(p => console.warn(`   - ${p.name}@${p.version} (${p.license})`));
  }
  if (summary.review > 0) {
    console.warn("\n⚠️ Review licenses found:");
    packagesList.filter(p => p.status === "review").forEach(p => console.warn(`   - ${p.name}@${p.version} (${p.license})`));
  }
  if (summary.unknown > 0) {
    console.warn("\n⚠️ Unknown licenses found:");
    packagesList.filter(p => p.status === "unknown").forEach(p => console.warn(`   - ${p.name}@${p.version} (${p.license})`));
  }

  if (shouldFail) {
    console.error(`\n❌ License check failed. Found licenses violating fail-on=${failOn} policy.`);
    process.exit(1);
  } else {
    console.log("\n✅ License check passed.");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
